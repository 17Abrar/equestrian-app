import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import {
  adminGetPaymentAccountByProvider,
  getBookingById,
  recordBookingRefund,
} from '@equestrian/db/queries';
import { writeTransaction } from '@equestrian/db';
import { bookings as bookingsTable } from '@equestrian/db/schema';
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
 * Concurrency safety (audit B-26): the heavy lift is now a
 * `SELECT ... FOR UPDATE` on the booking row inside a writeTransaction.
 * The lock blocks concurrent admin refunds AND webhook B-4 reversal
 * for the duration of the provider call (~1-2s for Stripe), so the
 * idempotency key always reflects the live `refundedAmountMinor`.
 * Three defence layers below the lock:
 *
 *   1. **Stable idempotency key**: keyed on
 *      `refund_<bookingId>_<refundedSoFar>_<amount>`. Two concurrent
 *      admins serialize on the lock; the second reads the post-first-
 *      refund refundedSoFar and computes a distinct key.
 *
 *   2. **Optimistic CAS in `recordBookingRefund`**: redundant under
 *      the FOR UPDATE lock but kept as belt-and-braces for any caller
 *      that bypasses the lock.
 *
 *   3. **Surface mismatches loudly**: `booking_refund_ledger_conflict`
 *      logs at error level. With the lock in place this should never
 *      fire; if it does, an out-of-band write is happening and an
 *      operator needs to investigate.
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
      // Cancellation/no-show fees are owed to the club out of the original
      // amount and must NOT be returned to the rider on refund. Audit AI-24.
      const cancellationFee = booking.cancellationFee ?? 0;
      const remaining = booking.amount - refundedSoFar - cancellationFee;

      if (remaining <= 0) {
        return errorResponse(
          'NOTHING_TO_REFUND',
          cancellationFee > 0 && refundedSoFar === 0
            ? 'Booking is fully consumed by the cancellation/no-show fee.'
            : 'Booking is already fully refunded.',
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

      // Lock the booking row, re-read the live refundedSoFar, call the
      // provider, then update the ledger — all inside a single
      // writeTransaction. Audit B-26.
      try {
        const result = await writeTransaction(async (tx) => {
          const lockedRows = await tx
            .select({
              refundedAmountMinor: bookingsTable.refundedAmountMinor,
              paymentStatus: bookingsTable.paymentStatus,
              // Audit LOW (2026-05-05 pass 2): include providerPaymentId
              // in the locked SELECT so the adapter call below uses the
              // post-lock value rather than the pre-lock `booking` snapshot.
              // `setBookingPaymentRef` enforces application-level
              // immutability (the only writer is the payment-init route,
              // and its WHERE predicate refuses to overwrite a non-null
              // value), so concurrent rewrite is unreachable today —
              // this is defense-in-depth that makes the lock self-
              // contained.
              providerPaymentId: bookingsTable.providerPaymentId,
            })
            .from(bookingsTable)
            .where(
              and(
                eq(bookingsTable.id, bookingId),
                eq(bookingsTable.clubId, ctx.clubId),
              ),
            )
            .for('update')
            .limit(1);
          const locked = lockedRows[0];
          if (!locked) {
            return { kind: 'not-found' as const };
          }

          const liveSoFar = locked.refundedAmountMinor ?? 0;
          if (locked.paymentStatus !== 'paid' && locked.paymentStatus !== 'partial') {
            return { kind: 'not-refundable' as const, status: locked.paymentStatus };
          }

          // Re-validate the requested amount against the LIVE running
          // total. A webhook B-4 reversal that landed between our pre-
          // lock read and now would lower refundedSoFar — that's fine,
          // the rider just has more refundable headroom. A second-admin
          // refund that landed first would raise it; recompute remaining.
          // cancellationFee is immutable once set by markBookingNoShow/
          // cancelBooking, so the pre-lock read remains authoritative —
          // audit AI-24.
          const liveRemaining = (booking.amount ?? 0) - liveSoFar - cancellationFee;
          if (liveRemaining <= 0) {
            return { kind: 'nothing-to-refund' as const };
          }
          const finalAmount = Math.min(requestedAmount, liveRemaining);

          // The route's pre-lock check for `requestedAmount > remaining`
          // already 422'd; we only get here when finalAmount equals
          // requestedAmount in the happy path. The min() above is a
          // belt-and-braces clamp for the rare lock-released case.
          // Use the post-lock providerPaymentId (audit LOW pass 2). The
          // pre-lock `booking.providerPaymentId` was sufficient given
          // `setBookingPaymentRef`'s immutability predicate, but the
          // locked read keeps the lock self-contained: if a future writer
          // bypasses that predicate, this still reads the live value.
          const lockedProviderPaymentId = locked.providerPaymentId;
          if (!lockedProviderPaymentId) {
            // Should be unreachable — payment-init writes this column
            // before the booking can be marked paid, and the route's
            // earlier check verified `paymentStatus = 'paid' | 'partial'`.
            return { kind: 'not-refundable' as const, status: locked.paymentStatus };
          }

          const refund = await adapter.refund({
            account,
            providerPaymentId: lockedProviderPaymentId,
            amountMinorUnits: finalAmount,
            reason: data.reason,
            idempotencyKey: `refund_${bookingId}_${liveSoFar}_${finalAmount}`,
          });

          // Inside the transaction, the CAS in recordBookingRefund is a
          // tautology — we hold the row lock — but it's cheap and
          // protects against a future caller that bypasses the lock.
          const updated = await recordBookingRefund(ctx.clubId, bookingId, finalAmount);
          if (!updated) {
            // Should be unreachable under FOR UPDATE; logged anyway so a
            // bypass surfaces.
            logger.error('booking_refund_ledger_conflict', {
              bookingId,
              clubId: ctx.clubId,
              provider,
              providerRefundId: refund.providerRefundId,
              requestedAmount: finalAmount,
              refundedSoFarAtRead: liveSoFar,
            });
            return { kind: 'race' as const, refundId: refund.providerRefundId };
          }

          return {
            kind: 'ok' as const,
            refund,
            updated,
            liveSoFar,
            finalAmount,
            previousStatus: locked.paymentStatus,
          };
        });

        if (result.kind === 'not-found') {
          return errorResponse('NOT_FOUND', 'Booking not found', 404);
        }
        if (result.kind === 'not-refundable') {
          return errorResponse(
            'NOT_REFUNDABLE',
            `Booking payment status is "${result.status}" — only paid or partially-refunded bookings can be refunded.`,
            422,
          );
        }
        if (result.kind === 'nothing-to-refund') {
          return errorResponse('NOTHING_TO_REFUND', 'Booking is already fully refunded.', 422);
        }
        if (result.kind === 'race') {
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
          providerRefundId: result.refund.providerRefundId,
          refundStatus: result.refund.status,
          amountMinor: result.finalAmount,
          newRefundedTotal: result.updated.refundedAmountMinor,
          newStatus: result.updated.paymentStatus,
          partial: result.updated.paymentStatus === 'partial',
        });

        void ctx.audit({
          action: 'booking.refund',
          resourceType: 'booking',
          resourceId: bookingId,
          changes: {
            refundedAmountMinor: {
              from: result.liveSoFar,
              to: result.updated.refundedAmountMinor,
            },
            paymentStatus: {
              from: result.previousStatus,
              to: result.updated.paymentStatus,
            },
          },
        });

        return successResponse({
          bookingId,
          provider,
          providerRefundId: result.refund.providerRefundId,
          status: result.refund.status,
          partial: result.updated.paymentStatus === 'partial',
          refundedAmountMinor: result.updated.refundedAmountMinor,
          remainingRefundableMinor:
            (booking.amount ?? 0) - result.updated.refundedAmountMinor - cancellationFee,
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
    {
      requiredPermission: 'bookings:update',
      // Audit AI-22 — refunds call the provider's refund API and write
      // the booking ledger; tighten from the default 60/min so a runaway
      // admin script can't drain the provider's idempotency space.
      // failClosed (audit AI-45) — money-moving endpoint, an Upstash
      // outage must not lift the cap.
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'booking_refund',
    },
  );
}

