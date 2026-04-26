import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  adminGetPaymentAccountByProvider,
  getBookingById,
  recordBookingRefund,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseOptionalBody } from '@/lib/api-utils';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  /**
   * Partial refund amount in minor units (fils). Omit to refund the
   * remaining balance (original amount minus whatever has already been
   * refunded). Must be <= `booking.amount - booking.refundedAmountMinor`.
   */
  amountMinorUnits: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

/**
 * Admin-initiated refund. Calls the provider that captured the original
 * payment (Stripe / N-Genius / Ziina) via its adapter, then records the
 * refund against the booking's running refund ledger.
 *
 * Partial refunds set `paymentStatus = 'partial'` and are re-entrant —
 * an admin can issue a 20 AED goodwill refund today and another 30 AED
 * tomorrow, up to the original amount. The status only flips to
 * 'refunded' once the running total equals the original amount.
 *
 * Concurrency safety (audit B-26): the route relies on three layers of
 * defence against admin-vs-admin and admin-vs-webhook races:
 *
 *   1. **Stable idempotency key**: keyed on
 *      `refund_<bookingId>_<refundedSoFar>_<amount>`. Two concurrent
 *      admins both reading `refundedSoFar=X` produce the same key and
 *      the provider returns the same refund object the second time —
 *      not a new charge.
 *
 *   2. **Optimistic CAS in `recordBookingRefund`**: only commits the
 *      ledger update if `refundedAmountMinor` is still the value we
 *      read at the start. The loser surfaces a 409 REFUND_RACE so the
 *      operator can re-check.
 *
 *   3. **Surface mismatches loudly**: `booking_refund_ledger_conflict`
 *      logs at error level (paged by the Sentry alert rules). The
 *      narrow window where a webhook B-4 reversal lands between the
 *      read and CAS leaves the provider with a successfully-issued
 *      refund that the ledger needs reconciled — manual operator
 *      action via the same provider's dashboard.
 *
 * The strongest fix (SELECT FOR UPDATE on the booking row, holding the
 * lock through the provider call) would queue refunds at the cost of
 * holding a Postgres row lock for ~1-2 seconds per call. Tracked as a
 * future improvement.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;

      const data = await parseOptionalBody(request, bodySchema);

      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      // 'paid' and 'partial' are both valid starting states — the latter
      // means an earlier refund already happened and there's still
      // headroom before the original amount.
      if (booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'partial') {
        return errorResponse(
          'NOT_REFUNDABLE',
          `Booking payment status is "${booking.paymentStatus}" — only paid or partially-refunded bookings can be refunded.`,
          422,
        );
      }

      if (!booking.paymentProvider || !booking.providerPaymentId) {
        return errorResponse(
          'NO_PROVIDER_REFERENCE',
          'Booking has no payment provider reference. Refund manually from the provider dashboard.',
          422,
        );
      }

      if (booking.amount == null) {
        return errorResponse(
          'NO_BOOKING_AMOUNT',
          'Booking has no captured amount to refund.',
          422,
        );
      }

      const refundedSoFar = booking.refundedAmountMinor ?? 0;
      const remaining = booking.amount - refundedSoFar;

      if (remaining <= 0) {
        return errorResponse(
          'NOTHING_TO_REFUND',
          'Booking is already fully refunded.',
          422,
        );
      }

      const requestedAmount = data.amountMinorUnits ?? remaining;

      if (requestedAmount > remaining) {
        return errorResponse(
          'AMOUNT_EXCEEDS_REMAINING',
          `Refund amount (${requestedAmount}) exceeds the remaining refundable balance (${remaining}).`,
          422,
        );
      }

      const provider = booking.paymentProvider as 'stripe' | 'n_genius' | 'ziina';
      // Fetch the account the payment was captured on — may differ from the
      // currently active provider if the club has since switched.
      const account = await adminGetPaymentAccountByProvider(ctx.clubId, provider);
      if (!account) {
        return errorResponse(
          'PROVIDER_ACCOUNT_NOT_FOUND',
          `The ${provider} account this payment was captured on is no longer connected.`,
          422,
        );
      }

      const adapter = getAdapter(provider);

      try {
        const refund = await adapter.refund({
          account,
          providerPaymentId: booking.providerPaymentId,
          amountMinorUnits: requestedAmount,
          reason: data.reason,
          // Stable key, parameterised on the running total at request time so
          // each partial refund has a distinct idempotency key. Without
          // `refundedSoFar` in the key, a second 20-AED partial would collide
          // with the first and the provider would no-op instead of refunding.
          idempotencyKey: `refund_${bookingId}_${refundedSoFar}_${requestedAmount}`,
        });

        const updated = await recordBookingRefund(ctx.clubId, bookingId, requestedAmount);

        if (!updated) {
          // Concurrent refund changed the running total between our read and
          // write — provider already captured the refund, so surface a soft
          // error and let the admin retry to see the current state.
          logger.error('booking_refund_ledger_conflict', {
            bookingId,
            clubId: ctx.clubId,
            provider,
            providerRefundId: refund.providerRefundId,
            requestedAmount,
            refundedSoFarAtRead: refundedSoFar,
          });
          return errorResponse(
            'REFUND_RACE',
            'Another refund was recorded in the meantime. Check the booking and try again if more refund is due.',
            409,
          );
        }

        logger.info('booking_refunded', {
          requestId: ctx.requestId,
          bookingId,
          clubId: ctx.clubId,
          provider,
          providerRefundId: refund.providerRefundId,
          refundStatus: refund.status,
          amountMinor: requestedAmount,
          newRefundedTotal: updated.refundedAmountMinor,
          newStatus: updated.paymentStatus,
          partial: updated.paymentStatus === 'partial',
        });

        void ctx.audit({
          action: 'booking.refund',
          resourceType: 'booking',
          resourceId: bookingId,
          changes: {
            refundedAmountMinor: {
              from: refundedSoFar,
              to: updated.refundedAmountMinor,
            },
            paymentStatus: { from: booking.paymentStatus, to: updated.paymentStatus },
          },
        });

        return successResponse({
          bookingId,
          provider,
          providerRefundId: refund.providerRefundId,
          status: refund.status,
          partial: updated.paymentStatus === 'partial',
          refundedAmountMinor: updated.refundedAmountMinor,
          remainingRefundableMinor: booking.amount - updated.refundedAmountMinor,
        });
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          logger.warn('booking_refund_provider_error', {
            bookingId,
            clubId: ctx.clubId,
            provider,
            code: err.code,
            message: err.message,
          });
          return errorResponse(err.code, err.message, 502);
        }
        throw err;
      }
    },
    { requiredPermission: 'bookings:update' },
  );
}
