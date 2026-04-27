import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getActivePaymentAccount,
  getBookingById,
  getClubById,
  setBookingPaymentRef,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseOptionalBody } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const bodySchema = z
  .object({
    /**
     * `hosted` forces a redirect-style payment URL for every provider (used
     * by mobile, which can't render Stripe Elements inline). Defaults to
     * `default` which lets each provider choose their native flow.
     */
    mode: z.enum(['default', 'hosted']).default('default'),
  })
  .partial();

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

// Payment methods that settle outside any online provider. Bookings with
// these methods never call `createPayment`.
const OFFLINE_PAYMENT_METHODS = new Set([
  'cash',
  'card_in_person',
  'bank_transfer',
  'package_credit',
]);

/**
 * Creates (or re-resolves) a payment for an existing booking via the club's
 * active payment provider. Idempotent on the booking id: Stripe and Ziina
 * return the original intent when called again with the same idempotency
 * key, so safe to retry after a dropped response.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;

      // Body is optional — default mode when absent.
      const { mode = 'default' } = await parseOptionalBody(request, bodySchema);

      // 1. Load booking, verify it belongs to the caller or they have staff rights.
      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      const canActForAny = hasPermission(ctx.orgRole, 'bookings:update');
      const isOwnBooking = ctx.memberId && booking.riderMemberId === ctx.memberId;
      if (!canActForAny && !isOwnBooking) {
        return errorResponse('FORBIDDEN', 'You can only pay for your own bookings', 403);
      }

      // 2. Booking state must be payable.
      if (booking.status === 'cancelled' || booking.status === 'no_show') {
        return errorResponse(
          'BOOKING_NOT_PAYABLE',
          `Booking is ${booking.status} and cannot accept payments`,
          422,
        );
      }
      if (booking.paymentStatus === 'paid') {
        return errorResponse('ALREADY_PAID', 'This booking is already paid', 422);
      }
      if (booking.paymentStatus === 'refunded') {
        return errorResponse('REFUNDED', 'This booking has been refunded', 422);
      }

      // 3. Offline payment methods settle at the stable — nothing for us to do.
      if (booking.paymentMethod && OFFLINE_PAYMENT_METHODS.has(booking.paymentMethod)) {
        return errorResponse(
          'OFFLINE_PAYMENT',
          `Booking uses ${booking.paymentMethod} and settles without an online provider`,
          422,
        );
      }

      // 4. Amount sanity — no point hitting a provider for a zero-amount row.
      if (!booking.amount || booking.amount <= 0) {
        return errorResponse(
          'NO_AMOUNT',
          'Booking has no amount to charge',
          422,
        );
      }

      // 5. Resolve the active provider. No provider = club hasn't connected one.
      const account = await getActivePaymentAccount(ctx.clubId);
      if (!account) {
        return errorResponse(
          'NO_ACTIVE_PROVIDER',
          'Your club has no active payment provider. Connect one in Settings > Payments.',
          422,
        );
      }

      const adapter = getAdapter(account.provider);
      // Stripe / N-Genius / Ziina all require ABSOLUTE return/cancel URLs.
      // A relative-URL fallback would silently misconfigure every provider —
      // fail loud at the first payment instead of leaving riders stranded
      // on a 4xx page from the provider.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!appUrl) {
        logger.error('payment_app_url_not_configured', {
          bookingId,
          clubId: ctx.clubId,
        });
        return errorResponse(
          'PROVIDER_NOT_CONFIGURED',
          'Payment return URL is not configured. Contact support.',
          503,
        );
      }
      // `?from=payment` tells the return-URL page that this is a post-redirect
      // landing so it can show "confirming payment…" while the webhook lands.
      const returnUrlPath = `/rider/bookings/${bookingId}?from=payment`;
      const returnUrl = new URL(returnUrlPath, appUrl).toString();

      // booking.amount is the NET (post-coupon) amount we charge — coupon
      // discounts are baked into it at booking-create time. Platform fee is
      // computed off the net charge because that's what we actually settle.
      // N-Genius and Ziina don't support split payments — their adapters
      // ignore applicationFeeMinorUnits.
      //
      // The fee is snapshotted on FIRST PI create (audit B-3). Stripe honours
      // `application_fee_amount` only on the first call; recomputing from a
      // live `clubs.platform_fee_percent` on retries would silently let
      // finance reports diverge from what Stripe captured if an admin lowered
      // the fee mid-flight.
      const bookingAmount = booking.amount;
      let applicationFeeMinorUnits: number | undefined;
      let persistFeeSnapshot = false;
      if (account.provider === 'stripe') {
        if (booking.applicationFeeMinor != null) {
          applicationFeeMinorUnits = booking.applicationFeeMinor;
        } else {
          const club = await getClubById(ctx.clubId);
          const feePercent = club ? Number(club.platformFeePercent) : 0;
          if (Number.isFinite(feePercent) && feePercent > 0) {
            applicationFeeMinorUnits = Math.round(bookingAmount * (feePercent / 100));
            persistFeeSnapshot = true;
          }
        }
        // Stripe rejects PaymentIntents where application_fee_amount +
        // Stripe's processing fee (~2.9% + 30c) exceeds the captured
        // amount. Clamp to ~70% of the booking so a misconfigured high
        // platform fee + a small booking doesn't surface as a Stripe
        // 400 with an unhelpful "amount too small" error to the rider.
        // Audit B-28.
        if (applicationFeeMinorUnits !== undefined) {
          const cap = Math.floor(bookingAmount * 0.7);
          if (applicationFeeMinorUnits > cap) {
            logger.warn('booking_payment_application_fee_clamped', {
              bookingId,
              clubId: ctx.clubId,
              requested: applicationFeeMinorUnits,
              cap,
              bookingAmount,
            });
            applicationFeeMinorUnits = Math.max(0, cap);
          }
        }
      }

      try {
        const paymentInput = {
          account,
          amountMinorUnits: bookingAmount,
          currency: booking.currency,
          bookingId: booking.id,
          riderId: booking.riderMemberId,
          clubId: ctx.clubId,
          description: booking.lessonTypeName
            ? `${booking.lessonTypeName} — ${booking.slotDate}`
            : `Lesson booking ${booking.id}`,
          // Stable idempotency per booking so retries don't duplicate intents.
          idempotencyKey: `booking_${booking.id}`,
          returnUrl,
          metadata: {
            bookingId: booking.id,
          },
          applicationFeeMinorUnits,
        };

        // Mobile clients (mode=hosted) need a redirect URL for every provider
        // since they can't render Stripe Elements inline. Adapters that don't
        // implement `createHostedCheckout` fall through to `createPayment`,
        // which for N-Genius and Ziina already returns a redirect URL.
        const result =
          mode === 'hosted' && adapter.createHostedCheckout
            ? await adapter.createHostedCheckout(paymentInput)
            : await adapter.createPayment(paymentInput);

        const updated = await setBookingPaymentRef(ctx.clubId, bookingId, {
          paymentProvider: account.provider,
          providerPaymentId: result.providerPaymentId,
          // Persist the fee snapshot on the first successful PI create so
          // retries read the same value (audit B-3).
          ...(persistFeeSnapshot && applicationFeeMinorUnits !== undefined
            ? { applicationFeeMinor: applicationFeeMinorUnits }
            : {}),
        });

        logger.info('booking_payment_initialized', {
          requestId: ctx.requestId,
          bookingId,
          clubId: ctx.clubId,
          provider: account.provider,
          providerPaymentId: result.providerPaymentId,
          flow: result.flow,
        });

        void ctx.audit({
          action: 'booking.payment_create',
          resourceType: 'booking',
          resourceId: bookingId,
        });

        // Expose only the fields the client needs — don't leak account creds.
        return successResponse({
          bookingId,
          provider: account.provider,
          providerPaymentId: result.providerPaymentId,
          flow: result.flow,
          ...(result.flow === 'inline'
            ? { clientSecret: result.clientSecret }
            : { paymentUrl: result.paymentUrl }),
          status: result.status,
          booking: updated,
        });
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          logger.warn('booking_payment_provider_error', {
            bookingId,
            clubId: ctx.clubId,
            provider: account.provider,
            code: err.code,
            message: err.message,
            retryable: err.retryable,
          });
          const status =
            err.code === 'ACCOUNT_NOT_CONNECTED' ? 422 :
            err.code === 'AUTH_FAILED' ? 502 :
            err.retryable ? 503 : 502;
          return errorResponse(err.code, err.message, status);
        }
        throw err;
      }
    },
    { requiredPermission: 'bookings:create' },
  );
}
