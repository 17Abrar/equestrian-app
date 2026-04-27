import React from 'react';
import { type NextRequest, after } from 'next/server';
import { cancelBookingSchema } from '@equestrian/shared/schemas';
import { calculateCancellationFee, formatMoney } from '@equestrian/shared/utils';
import {
  adminGetPaymentAccountByProvider,
  getBookingById,
  getBookingSlotById,
  cancelBooking,
  getMemberById,
  getClubById,
  recordBookingRefund,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
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

    if (!canReadAny && booking.riderMemberId !== ctx.memberId) {
      return errorResponse('FORBIDDEN', 'You can only view your own bookings', 403);
    }

    return successResponse(booking);
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;
      const body = await request.json();
      const data = validateInput(cancelBookingSchema, body);

      // Determine permission level
      const canCancelAny = hasPermission(ctx.orgRole, 'bookings:update');
      const canCancelOwn = hasPermission(ctx.orgRole, 'bookings:cancel_own');

      if (!canCancelAny && !canCancelOwn) {
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
        return errorResponse('NO_SHOW_FINAL', 'No-show bookings cannot be retroactively cancelled', 422);
      }

      if (!ctx.memberId) {
        return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
      }

      // Riders can only cancel their own bookings
      if (canCancelOwn && !canCancelAny && existing.riderMemberId !== ctx.memberId) {
        return errorResponse('FORBIDDEN', 'You can only cancel your own bookings', 403);
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
        return errorResponse('INTERNAL_ERROR', 'Unable to process cancellation — related data not found', 500);
      }

      // Calculate cancellation fee from the lesson sticker price, then clamp
      // to the actually-charged amount so a 100%-late fee on a coupon-
      // discounted booking never exceeds what the rider paid (audit B-2).
      const feeResult = calculateCancellationFee({
        slotDate: slot.date,
        slotStartTime: slot.startTime,
        timezone: club.timezone,
        cancellationNoticeHours: club.cancellationNoticeHours,
        lateCancellationFeePercent: Number(club.lateCancellationFeePercent),
        lessonPrice: slot.lessonTypePrice,
      });
      const fee =
        existing.amount != null
          ? Math.min(feeResult.fee, existing.amount)
          : feeResult.fee;

      // If the booking was paid online and there's any remainder owed back,
      // refund the provider FIRST (audit B-1). On provider failure we abort
      // before flipping booking state — the rider's email and the DB ledger
      // would otherwise advertise a refund that never actually issued.
      const refundedSoFar = existing.refundedAmountMinor ?? 0;
      const wasPaidOnline =
        (existing.paymentStatus === 'paid' || existing.paymentStatus === 'partial') &&
        existing.paymentProvider !== null &&
        existing.providerPaymentId !== null;
      const remainingToRefund =
        wasPaidOnline && existing.amount != null
          ? Math.max(0, existing.amount - fee - refundedSoFar)
          : 0;

      let providerRefundId: string | null = null;
      if (remainingToRefund > 0 && existing.paymentProvider && existing.providerPaymentId) {
        const provider = existing.paymentProvider;
        const account = await adminGetPaymentAccountByProvider(ctx.clubId, provider);
        if (!account) {
          return errorResponse(
            'PROVIDER_ACCOUNT_NOT_FOUND',
            `The ${provider} account this payment was captured on is no longer connected. Cancellation aborted — issue the refund manually before retrying.`,
            422,
          );
        }
        const adapter = getAdapter(provider);
        try {
          const refund = await adapter.refund({
            account,
            providerPaymentId: existing.providerPaymentId,
            amountMinorUnits: remainingToRefund,
            reason: data.reason,
            // Stable across retries (refundedSoFar + amount produce the same
            // key for the same logical refund). Distinct from the standalone
            // /refund route's keys so they can't collide if both fire near-
            // simultaneously.
            idempotencyKey: `cancel_refund_${bookingId}_${refundedSoFar}_${remainingToRefund}`,
          });
          providerRefundId = refund.providerRefundId;
        } catch (err) {
          if (err instanceof PaymentProviderError) {
            logger.warn('cancel_refund_provider_error', {
              bookingId,
              clubId: ctx.clubId,
              provider,
              code: err.code,
              message: err.message,
              retryable: err.retryable,
            });
            return errorResponse(
              'REFUND_FAILED',
              `Provider refund failed: ${err.message}. Cancellation aborted.`,
              502,
            );
          }
          throw err;
        }
      }

      const cancelled = await cancelBooking(
        ctx.clubId,
        bookingId,
        data.reason,
        ctx.memberId,
        fee,
      );

      if (!cancelled) {
        // Provider refund (if any) succeeded but the booking didn't transition
        // — surfaces as a 500 because at this point money has moved and
        // someone needs to investigate. Idempotency-keyed refunds mean a
        // retry won't double-charge.
        if (providerRefundId) {
          logger.error('cancel_refund_orphaned', {
            bookingId,
            clubId: ctx.clubId,
            providerRefundId,
            remainingToRefund,
          });
        }
        return errorResponse('CANCEL_FAILED', 'Failed to cancel booking', 500);
      }

      // Update the refund ledger so finance reports + future refund attempts
      // see the correct running total.
      if (remainingToRefund > 0 && providerRefundId) {
        const updated = await recordBookingRefund(ctx.clubId, bookingId, remainingToRefund);
        if (!updated) {
          logger.error('cancel_refund_ledger_conflict', {
            bookingId,
            clubId: ctx.clubId,
            providerRefundId,
            remainingToRefund,
          });
          // Don't fail the request — provider already refunded, booking is
          // cancelled. The ledger conflict means a webhook landed in the
          // narrow window; reconciliation surfaces in the next webhook.
        }
      }

      logger.info('booking_cancelled', {
        requestId: ctx.requestId,
        bookingId,
        clubId: ctx.clubId,
        cancelledBy: ctx.memberId,
        reason: data.reason,
        cancellationFee: fee,
        isLateCancellation: feeResult.isLate,
        refundedAmountMinor: remainingToRefund,
        providerRefundId,
      });

      void ctx.audit({
        action: 'booking.cancel',
        resourceType: 'booking',
        resourceId: bookingId,
        changes: {
          status: { from: existing.status, to: 'cancelled' },
          cancellationFee: { from: 0, to: fee },
          ...(remainingToRefund > 0
            ? {
                refundedAmountMinor: {
                  from: refundedSoFar,
                  to: refundedSoFar + remainingToRefund,
                },
              }
            : {}),
        },
      });

      // Post-response cancellation email — `after()` keeps the task alive
      // past response flush on Cloudflare Workers.
      after(async () => {
        try {
          const riderMember = await getMemberById(ctx.clubId, existing.riderMemberId);
          if (!riderMember?.email) return;

          const feeDisplay = fee > 0
            ? formatMoney(fee, existing.currency)
            : undefined;

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
  );
}
