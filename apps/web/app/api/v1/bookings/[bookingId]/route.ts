import React from 'react';
import { type NextRequest, after } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import { cancelBookingSchema } from '@equestrian/shared/schemas';
import { calculateCancellationFee, coerceFeePercent, formatMoney } from '@equestrian/shared/utils';
import {
  adminGetPaymentAccountByProvider,
  getBookingById,
  getBookingSlotById,
  getMemberByIdIncludingDeactivated,
  getClubById,
  isParentOf,
} from '@equestrian/db/queries';
import { writeTransaction } from '@equestrian/db';
import { bookings as bookingsTable, bookingSlots } from '@equestrian/db/schema';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { sendTriggeredEmail } from '@/lib/email';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { bookingId } = await params;
    validateUuidParam('bookingId', bookingId);

    // Staff (bookings:read / bookings:*) see any booking; riders and parents
    // (bookings:read_own / bookings:read_child) see only their own. Inline
    // check rather than `requiredPermission` so we can enforce the
    // own-booking constraint after loading the row.
    const canReadAny = hasPermission(ctx.orgRole, 'bookings:read');
    const canReadOwn =
      hasPermission(ctx.orgRole, 'bookings:read_own') ||
      hasPermission(ctx.orgRole, 'bookings:read_child');

    if (!canReadAny && !canReadOwn) {
      return errorResponse('FORBIDDEN', 'You do not have permission to view bookings', 403);
    }

    const booking = await getBookingById(ctx.clubId, bookingId);

    if (!booking) {
      return errorResponse('NOT_FOUND', 'Booking not found', 404);
    }

    // Audit pass-3 follow-up B (2026-05-09): parents (`bookings:read_child`)
    // book on behalf of their kids — the booking row's `riderMemberId`
    // points at the CHILD, not the parent. The list endpoint
    // (`bookings/route.ts`) and the payment endpoint already thread
    // `isParentOf` through; this detail GET was missing the same gate
    // and silently 403'd parents trying to read their own kid's booking.
    const canReadChild = hasPermission(ctx.orgRole, 'bookings:read_child');
    const isSelf = !!ctx.memberId && booking.riderMemberId === ctx.memberId;
    let isGuardian = false;
    if (!isSelf && canReadChild && ctx.memberId) {
      isGuardian = await isParentOf(ctx.clubId, ctx.memberId, booking.riderMemberId);
    }

    if (!canReadAny && !isSelf && !isGuardian) {
      return errorResponse('FORBIDDEN', 'You can only view your own bookings', 403);
    }

    return successResponse(booking);
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;
      validateUuidParam('bookingId', bookingId);
      // Audit F-63 (2026-05-07 r5): migrated from `request.json()` to
      // `parseRequiredBody` for the post-text Content-Length recheck +
      // INVALID_JSON 400 mapping.
      const data = await parseRequiredBody(request, cancelBookingSchema);

      // Determine permission level
      const canCancelAny = hasPermission(ctx.orgRole, 'bookings:update');
      const canCancelOwn = hasPermission(ctx.orgRole, 'bookings:cancel_own');
      // Parents who originally booked on behalf of a child should be
      // able to cancel that booking too — the booking's riderMemberId
      // is the CHILD, not the parent. `bookings:create_child` is the
      // grant that lets them book; we accept it as the cancel grant
      // for the same set of bookings.
      const canCancelChild = hasPermission(ctx.orgRole, 'bookings:create_child');

      if (!canCancelAny && !canCancelOwn && !canCancelChild) {
        return errorResponse('FORBIDDEN', 'You do not have permission to cancel bookings', 403);
      }

      const existing = await getBookingById(ctx.clubId, bookingId);
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      if (existing.status === 'cancelled') {
        return errorResponse('ALREADY_CANCELLED', 'Booking is already cancelled', 422);
      }

      if (existing.status === 'completed') {
        return errorResponse('ALREADY_COMPLETED', 'Cannot cancel a completed booking', 422);
      }

      // No-show is a terminal state with its own penalty + attendance count.
      // Don't let a follow-up cancel clobber either — see audit E-1.
      if (existing.status === 'no_show') {
        return errorResponse(
          'NO_SHOW_FINAL',
          'No-show bookings cannot be retroactively cancelled',
          422,
        );
      }

      if (!ctx.memberId) {
        return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
      }

      // Audit pass-3 follow-up B (2026-05-09): mirror the GET branch —
      // a parent cancelling their kid's booking matches via `isParentOf`,
      // not riderMemberId equality.
      if (!canCancelAny) {
        const isSelf = existing.riderMemberId === ctx.memberId;
        let isGuardian = false;
        if (!isSelf && canCancelChild) {
          isGuardian = await isParentOf(ctx.clubId, ctx.memberId, existing.riderMemberId);
        }
        if (!isSelf && !isGuardian) {
          return errorResponse('FORBIDDEN', 'You can only cancel your own bookings', 403);
        }
      }

      // Fetch slot and club for fee calculation + email
      const [slot, club] = await Promise.all([
        getBookingSlotById(ctx.clubId, existing.slotId),
        getClubById(ctx.clubId),
      ]);

      if (!slot || !club) {
        logger.error('cancel_booking_missing_data', {
          bookingId,
          clubId: ctx.clubId,
          slotFound: !!slot,
          clubFound: !!club,
        });
        return errorResponse(
          'INTERNAL_ERROR',
          'Unable to process cancellation — related data not found',
          500,
        );
      }

      // Calculate cancellation fee against the actual charged amount
      // (net of coupon discount), not the sticker price. Audit H-6: a
      // rider who used a 50% coupon and paid 500 AED on a 1000 AED
      // lesson should owe `feePercent% × 500`, not `feePercent% × 1000`
      // clamped to 500 — the previous formula effectively double-charged
      // coupon-using riders. The clamp to `existing.amount` is preserved
      // so a malformed lessonPrice can never cause an overcharge.
      const feeBase = existing.amount ?? slot.lessonTypePrice;
      // Audit F-59 (2026-05-08 r6): see no-show route for rationale.
      const feeResult = calculateCancellationFee({
        slotDate: slot.date,
        slotStartTime: slot.startTime,
        timezone: club.timezone,
        cancellationNoticeHours: club.cancellationNoticeHours,
        lateCancellationFeePercent: coerceFeePercent(
          club.lateCancellationFeePercent ?? '0',
          'lateCancellationFeePercent',
        ),
        lessonPrice: feeBase,
      });
      const fee =
        existing.amount != null ? Math.min(feeResult.fee, existing.amount) : feeResult.fee;

      // If the booking was paid online and there's any remainder owed back,
      // refund the provider FIRST (audit B-1). On provider failure we abort
      // before flipping booking state — the rider's email and the DB ledger
      // would otherwise advertise a refund that never actually issued.
      // Pre-flight provider-account fetch — surfaces as 422 if the club
      // disconnected the provider mid-flight, before we lock the booking
      // row. Audit AI-18: the cancel-with-refund flow now mirrors the
      // standalone /refund route's lock-then-call pattern so cancelBooking
      // and recordBookingRefund are committed atomically with the
      // provider call.
      const wasPaidOnline =
        (existing.paymentStatus === 'paid' || existing.paymentStatus === 'partial') &&
        existing.paymentProvider !== null &&
        existing.providerPaymentId !== null;

      let preflightAccount: Awaited<ReturnType<typeof adminGetPaymentAccountByProvider>> = null;
      if (wasPaidOnline && existing.paymentProvider) {
        preflightAccount = await adminGetPaymentAccountByProvider(
          ctx.clubId,
          existing.paymentProvider,
        );
        if (!preflightAccount) {
          return errorResponse(
            'PROVIDER_ACCOUNT_NOT_FOUND',
            `The ${existing.paymentProvider} account this payment was captured on is no longer connected. Cancellation aborted — issue the refund manually before retrying.`,
            422,
          );
        }
      }

      let providerRefundId: string | null = null;
      let refundAmountRequested = 0;
      let refundLedgerAmount = 0;
      let providerRefundStatus: 'pending' | 'succeeded' | 'failed' | null = null;
      let cancelled: { id: string; slotId: string } | null = null;

      const result = await writeTransaction(async (tx) => {
        // 1. Lock the booking row to serialise concurrent cancel/refund
        //    attempts and any webhook-driven ledger update. Read every
        //    field used by the provider call from the LOCKED row, not
        //    the pre-lock `existing` (audit B-3) — a webhook could
        //    have flipped providerPaymentId between the two reads.
        const lockedRows = await tx
          .select({
            amount: bookingsTable.amount,
            refundedAmountMinor: bookingsTable.refundedAmountMinor,
            paymentStatus: bookingsTable.paymentStatus,
            status: bookingsTable.status,
            slotId: bookingsTable.slotId,
            paymentProvider: bookingsTable.paymentProvider,
            providerPaymentId: bookingsTable.providerPaymentId,
            currency: bookingsTable.currency,
          })
          .from(bookingsTable)
          .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.clubId, ctx.clubId)))
          .for('update')
          .limit(1);
        const locked = lockedRows[0];
        if (!locked) {
          return { kind: 'not-found' as const };
        }

        // 2. Re-validate the booking state under the lock. A racing
        //    cancel could have landed first.
        if (
          locked.status === 'cancelled' ||
          locked.status === 'completed' ||
          locked.status === 'no_show'
        ) {
          return { kind: 'terminal' as const, status: locked.status };
        }

        // 3. Compute remainingToRefund from the LIVE refundedAmountMinor
        //    rather than the pre-lock read.
        const liveRefundedSoFar = locked.refundedAmountMinor ?? 0;
        const liveRemaining =
          wasPaidOnline && locked.amount != null
            ? Math.max(0, locked.amount - fee - liveRefundedSoFar)
            : 0;

        // 4. Call the provider INSIDE the lock. Use the LOCKED row's
        //    paymentProvider + providerPaymentId so a webhook landing
        //    between the pre-lock read and the lock can't direct the
        //    refund at the wrong account/charge id (audit B-3).
        let refundIdLocal: string | null = null;
        let refundStatusLocal: 'pending' | 'succeeded' | 'failed' | null = null;
        if (
          liveRemaining > 0 &&
          locked.paymentProvider &&
          locked.providerPaymentId &&
          preflightAccount
        ) {
          const adapter = getAdapter(locked.paymentProvider);
          try {
            const refund = await adapter.refund({
              account: preflightAccount,
              providerPaymentId: locked.providerPaymentId,
              amountMinorUnits: liveRemaining,
              reason: data.reason,
              idempotencyKey: `cancel_refund_${bookingId}_${liveRefundedSoFar}_${liveRemaining}`,
            });
            if (refund.status === 'failed') {
              return {
                kind: 'provider-error' as const,
                code: 'REFUND_FAILED',
                message: 'Provider reported the refund as failed',
                retryable: false,
              };
            }
            refundIdLocal = refund.providerRefundId;
            refundStatusLocal = refund.status;
          } catch (err) {
            if (err instanceof PaymentProviderError) {
              return {
                kind: 'provider-error' as const,
                code: err.code,
                message: err.message,
                retryable: err.retryable,
              };
            }
            throw err;
          }
        }

        // 5. Apply the cancellation: status='cancelled', fee, cancelledAt,
        //    cancelledByMemberId. Same SQL guard cancelBooking uses.
        const cancelledRow = await tx
          .update(bookingsTable)
          .set({
            status: 'cancelled',
            cancellationReason: data.reason,
            cancellationFee: fee,
            cancelledAt: new Date(),
            cancelledByMemberId: ctx.memberId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bookingsTable.id, bookingId),
              eq(bookingsTable.clubId, ctx.clubId),
              // Belt-and-braces: the FOR UPDATE lock above already
              // serialises us, but re-assert the non-terminal predicate.
              eq(bookingsTable.status, locked.status),
            ),
          )
          .returning({ id: bookingsTable.id, slotId: bookingsTable.slotId });
        const cancelledLocal = cancelledRow[0];
        if (!cancelledLocal) {
          // Should be unreachable — we hold FOR UPDATE on this row.
          return { kind: 'cancel-failed' as const, refundId: refundIdLocal };
        }

        // 6. Decrement the slot's rider count.
        // Audit F-34 (2026-05-07 r4): explicit clubId predicate alongside
        // the composite FK so this update can never escape the tenant.
        await tx
          .update(bookingSlots)
          .set({
            currentRiders: sql`GREATEST(${bookingSlots.currentRiders} - 1, 0)`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(bookingSlots.id, cancelledLocal.slotId), eq(bookingSlots.clubId, ctx.clubId)),
          );

        // 7. Update the refund ledger inside the same tx. Mirrors
        //    recordBookingRefund's optimistic CAS but the FOR UPDATE
        //    above means the CAS is a tautology — kept as a guard
        //    against any future caller that bypasses the lock. Audit
        //    pass 6: only ledger terminal succeeded refunds. Pending
        //    refunds are finalized by provider webhooks/reconciliation.
        if (
          refundIdLocal &&
          refundStatusLocal === 'succeeded' &&
          liveRemaining > 0 &&
          locked.amount != null
        ) {
          const newRefunded = liveRefundedSoFar + liveRemaining;
          const newStatus = newRefunded >= locked.amount ? 'refunded' : 'partial';

          await tx
            .update(bookingsTable)
            .set({
              refundedAmountMinor: newRefunded,
              paymentStatus: newStatus,
              updatedAt: new Date(),
            })
            .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.clubId, ctx.clubId)));
        }

        return {
          kind: 'ok' as const,
          cancelled: cancelledLocal,
          refundId: refundIdLocal,
          refundStatus: refundStatusLocal,
          refundAmountRequested: refundIdLocal ? liveRemaining : 0,
          refundLedgerAmount: refundStatusLocal === 'succeeded' ? liveRemaining : 0,
        };
      });

      if (result.kind === 'not-found') {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }
      if (result.kind === 'terminal') {
        return errorResponse(
          'ALREADY_TERMINAL',
          `Booking is ${result.status} and cannot be cancelled`,
          422,
        );
      }
      if (result.kind === 'provider-error') {
        logger.warn('cancel_refund_provider_error', {
          bookingId,
          clubId: ctx.clubId,
          provider: existing.paymentProvider,
          code: result.code,
          message: result.message,
          retryable: result.retryable,
        });
        return errorResponse(
          'REFUND_FAILED',
          `Provider refund failed: ${result.message}. Cancellation aborted.`,
          502,
        );
      }
      if (result.kind === 'cancel-failed') {
        if (result.refundId) {
          logger.error('cancel_refund_orphaned', {
            bookingId,
            clubId: ctx.clubId,
            providerRefundId: result.refundId,
          });
        }
        return errorResponse('CANCEL_FAILED', 'Failed to cancel booking', 500);
      }

      cancelled = result.cancelled;
      providerRefundId = result.refundId;
      providerRefundStatus = result.refundStatus;
      refundAmountRequested = result.refundAmountRequested;
      refundLedgerAmount = result.refundLedgerAmount;

      if (!cancelled) {
        return errorResponse('CANCEL_FAILED', 'Failed to cancel booking', 500);
      }
      // Refund ledger refresh value used below in the audit/log payload.
      const refundedSoFar = existing.refundedAmountMinor ?? 0;

      logger.info('booking_cancelled', {
        requestId: ctx.requestId,
        bookingId,
        clubId: ctx.clubId,
        cancelledBy: ctx.memberId,
        reasonProvided: data.reason.length > 0,
        cancellationFee: fee,
        isLateCancellation: feeResult.isLate,
        refundAmountRequested,
        refundedAmountMinor: refundLedgerAmount,
        providerRefundId,
        providerRefundStatus,
      });

      void ctx.audit({
        action: 'booking.cancel',
        resourceType: 'booking',
        resourceId: bookingId,
        changes: {
          status: { from: existing.status, to: 'cancelled' },
          cancellationFee: { from: 0, to: fee },
          ...(refundLedgerAmount > 0
            ? {
                refundedAmountMinor: {
                  from: refundedSoFar,
                  to: refundedSoFar + refundLedgerAmount,
                },
              }
            : {}),
        },
      });

      // Post-response cancellation email — `after()` keeps the task alive
      // past response flush on Cloudflare Workers.
      after(async () => {
        try {
          // Audit F-30 (2026-05-07 r4): post-response cancellation
          // email — historical view; rider may have been deactivated
          // between booking creation and cancellation.
          const riderMember = await getMemberByIdIncludingDeactivated(
            ctx.clubId,
            existing.riderMemberId,
          );
          if (!riderMember?.email) return;

          const feeDisplay = fee > 0 ? formatMoney(fee, existing.currency) : undefined;

          await sendTriggeredEmail({
            clubId: ctx.clubId,
            trigger: 'booking_cancellation',
            to: riderMember.email,
            subject: `Booking Cancelled — ${existing.lessonTypeName}`,
            template: React.createElement(BookingCancellation, {
              riderName: existing.riderName ?? riderMember.displayName ?? '',
              lessonType: existing.lessonTypeName,
              date: String(existing.slotDate),
              time: String(existing.slotStartTime),
              arena: existing.arenaName ?? 'Arena',
              clubName: club.name,
              reason: data.reason,
              cancellationFee: feeDisplay,
              isLateCancellation: feeResult.isLate,
            }),
          });
        } catch (err) {
          // Email failure is non-fatal for the request, but Sentry needs
          // to see it under the right `logger.event` tag so the
          // OBSERVABILITY.md alert rule fires. Otherwise the throw
          // surfaces as a raw unhandled Error that bypasses our
          // structured logging entirely.
          logger.error('email_send_failed', {
            trigger: 'booking_cancellation',
            bookingId,
            clubId: ctx.clubId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });

      return successResponse(cancelled);
    },
    {
      // Audit MED (2026-05-05 pass 2): cancel-with-refund hits the
      // payment provider's refund API and writes the booking ledger —
      // money-moving by definition. Sibling routes (`bookings/[id]/refund`
      // and `bookings/[id]/payment`) already cap at 10/min/user
      // failClosed; this DELETE was inheriting the default 60/min,
      // letting a runaway client or replay loop fire 60 refund calls
      // a minute. failClosed = an Upstash outage cannot lift the cap.
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'booking_cancel',
    },
  );
}
