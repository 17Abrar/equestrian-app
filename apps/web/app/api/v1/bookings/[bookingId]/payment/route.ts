import { type NextRequest } from 'next/server';
import { z } from 'zod';

// Audit F-37 + F-68 (2026-05-08 r6): narrowing schema for the
// `account.metadata` JSON column. Provider adapters write their own
// shape (Stripe puts `defaultCurrency`/`livemode`/`country` here;
// N-Genius/Ziina put a smaller subset). All we read at this callsite
// is `defaultCurrency` for the booking-currency mismatch guard, so
// the schema is intentionally tolerant: extra keys pass through
// (no `.strict()`), and a missing/non-string `defaultCurrency`
// surfaces as `undefined` and skips the guard (current behavior).
const paymentAccountMetadataSchema = z
  .object({
    defaultCurrency: z.string().optional(),
  })
  .passthrough();
import {
  getActivePaymentAccount,
  getBookingById,
  isParentOf,
  setBookingPaymentRef,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseOptionalBody, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { withProviderRetry } from '@/lib/payments/retry';
import { logger } from '@/lib/logger';

// Audit F-36 (2026-05-07 r4): `.strict()` so future contributors who add
// fields (`currency`, `idempotencyKey`, …) can't have unknown keys
// silently dropped. Zod preserves strict mode through `.partial()`.
const bodySchema = z
  .object({
    /**
     * `hosted` forces a redirect-style payment URL for every provider (used
     * by mobile, which can't render Stripe Elements inline). Defaults to
     * `default` which lets each provider choose their native flow.
     */
    mode: z.enum(['default', 'hosted']).default('default'),
  })
  .strict()
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
      validateUuidParam('bookingId', bookingId);

      // Body is optional — default mode when absent.
      const { mode = 'default' } = await parseOptionalBody(request, bodySchema);

      // 1. Load booking, verify it belongs to the caller or they have staff rights.
      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      // Authorization. Three valid callers:
      //   - Staff with `bookings:update` (manager/admin) — pays on behalf
      //     of any rider in the club.
      //   - The rider themselves — booking.riderMemberId === ctx.memberId.
      //   - The rider's parent — `bookings:create_child` grant AND a
      //     `rider_profiles.parent_member_id` match. Without this branch,
      //     a parent who used POST /bookings to book a child's lesson
      //     could not initialize its payment.
      // The outer `requiredPermission: 'bookings:create'` was removed
      // because it 403'd parents (who hold `bookings:create_child`,
      // not `bookings:create`) before the inline check ran.
      const canActForAny = hasPermission(ctx.orgRole, 'bookings:update');
      const isOwnBooking = !!ctx.memberId && booking.riderMemberId === ctx.memberId;
      const canPayForChild = !!ctx.memberId && hasPermission(ctx.orgRole, 'bookings:create_child');
      let isGuardianOfRider = false;
      if (canPayForChild && ctx.memberId && !isOwnBooking) {
        isGuardianOfRider = await isParentOf(
          ctx.clubId,
          ctx.memberId,
          booking.riderMemberId,
        );
      }
      if (!canActForAny && !isOwnBooking && !isGuardianOfRider) {
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

      // Audit MED-11 (2026-05-05): currency parity — refuse to drive a
      // payment if the booking's currency doesn't match what the
      // active provider account was connected as. Failure mode without
      // this check: Stripe/Ziina return a confused 5xx on the first
      // charge for a non-matching currency, leaving the rider with no
      // pay link and a "something went wrong" toast. The metadata
      // shape varies by provider — Stripe stores `defaultCurrency` on
      // metadata; N-Genius/Ziina don't always — so we only enforce
      // when the data is present. Soft-fail otherwise (the provider
      // call will surface a clearer error).
      //
      // Audit F-37 + F-68 (2026-05-08 r6): drop the
      // `as Record<string, unknown>` cast in favor of a Zod
      // narrowing schema. The cast was the lone shipped
      // `as Record<string, unknown>` outside audit-log/logger/api-
      // client boundaries; without narrowing, a future schema
      // change that stores `defaultCurrency` as object/null silently
      // skips the currency-mismatch guard. The `.optional()` keeps
      // the soft-fail posture.
      const accountCurrency = paymentAccountMetadataSchema.safeParse(
        account.metadata ?? null,
      ).data?.defaultCurrency?.toUpperCase() ?? null;
      if (accountCurrency && booking.currency.toUpperCase() !== accountCurrency) {
        logger.warn('booking_payment_currency_mismatch', {
          bookingId,
          clubId: ctx.clubId,
          provider: account.provider,
          bookingCurrency: booking.currency,
          accountCurrency,
        });
        return errorResponse(
          'CURRENCY_MISMATCH',
          `Booking is in ${booking.currency.toUpperCase()} but the active payment provider settles in ${accountCurrency}. Reach out to support to align them.`,
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
      // discounts are baked into it at booking-create time. We do NOT take
      // a platform cut: each club runs Stripe / N-Genius / Ziina under
      // their own merchant account and the full amount lands directly in
      // the club's balance. Cavaliq revenue comes from the subscription
      // tiers, not per-booking application fees.
      try {
        // Audit F-42 (2026-05-07 r4): embed `bookingId` in the description
        // as a defense-in-depth webhook-recovery hint. If the
        // `setBookingPaymentRef` write below fails after the provider
        // intent succeeds, Ziina/N-Genius webhooks (which don't echo
        // metadata) can still resolve the booking by parsing the
        // description suffix.
        const baseDescription = booking.lessonTypeName
          ? `${booking.lessonTypeName} — ${booking.slotDate}`
          : `Lesson booking`;
        const paymentInput = {
          account,
          amountMinorUnits: booking.amount,
          currency: booking.currency,
          bookingId: booking.id,
          riderId: booking.riderMemberId,
          clubId: ctx.clubId,
          description: `${baseDescription} [booking:${booking.id}]`,
          // Stable idempotency per booking so retries don't duplicate intents.
          idempotencyKey: `booking_${booking.id}`,
          returnUrl,
          metadata: {
            bookingId: booking.id,
          },
        };

        // Mobile clients (mode=hosted) need a redirect URL for every provider
        // since they can't render Stripe Elements inline. Adapters that don't
        // implement `createHostedCheckout` fall through to `createPayment`,
        // which for N-Genius and Ziina already returns a redirect URL.
        //
        // Audit F-23 (2026-05-07 r5): wrap the adapter call in
        // `withProviderRetry`. The idempotencyKey
        // (`booking_${booking.id}`) is stable, so a transient 5xx /
        // 429 from Stripe / N-Genius / Ziina (each adapter sets
        // `retryable: true` on those) gets one or two retries before
        // bubbling out to the catch branch below. Mirrors
        // `lib/email.ts` `sendWithRetry`.
        const result = await withProviderRetry(
          () =>
            mode === 'hosted' && adapter.createHostedCheckout
              ? adapter.createHostedCheckout(paymentInput)
              : adapter.createPayment(paymentInput),
          {
            label: 'booking_payment_init',
            context: {
              bookingId,
              clubId: ctx.clubId,
              provider: account.provider,
            },
          },
        );

        const updated = await setBookingPaymentRef(ctx.clubId, bookingId, {
          paymentProvider: account.provider,
          providerPaymentId: result.providerPaymentId,
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
        // The publishable key is only on the inline Stripe path; redirect
        // flows (N-Genius, Ziina, Stripe Checkout) hand back a hosted URL
        // and never need it.
        return successResponse({
          bookingId,
          provider: account.provider,
          providerPaymentId: result.providerPaymentId,
          flow: result.flow,
          ...(result.flow === 'inline'
            ? {
                clientSecret: result.clientSecret,
                publishableKey: result.publishableKey,
              }
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
    {
      // Permission gate is inline above — `bookings:create` would 403
      // parents who pay for child bookings under `bookings:create_child`.
      // The inline check authorizes staff, the rider themselves, and the
      // rider's recorded guardian.
      // Audit AI-22 — payment-init creates real Stripe/N-Genius/Ziina
      // PaymentIntents (real money in observability). Tighten from the
      // default 60/min so a runaway client or replay loop can't flood
      // the provider with intents. failClosed (audit AI-45) — an Upstash
      // outage must NOT lift the cap on a money-moving endpoint.
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'booking_payment_init',
    },
  );
}
