import React from 'react';
import { type NextRequest, after } from 'next/server';
import { cancelBookingSchema } from '@equestrian/shared/schemas';
import { calculateCancellationFee, formatMoney } from '@equestrian/shared/utils';
import {
  getBookingById,
  getBookingSlotById,
  cancelBooking,
  getMemberById,
  getClubById,
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

      // Calculate cancellation fee
      const feeResult = calculateCancellationFee({
        slotDate: slot.date,
        slotStartTime: slot.startTime,
        timezone: club.timezone,
        cancellationNoticeHours: club.cancellationNoticeHours,
        lateCancellationFeePercent: Number(club.lateCancellationFeePercent),
        lessonPrice: slot.lessonTypePrice,
      });

      const cancelled = await cancelBooking(
        ctx.clubId,
        bookingId,
        data.reason,
        ctx.memberId,
        feeResult.fee,
      );

      if (!cancelled) {
        return errorResponse('CANCEL_FAILED', 'Failed to cancel booking', 500);
      }

      logger.info('booking_cancelled', {
        requestId: ctx.requestId,
        bookingId,
        clubId: ctx.clubId,
        cancelledBy: ctx.memberId,
        reason: data.reason,
        cancellationFee: feeResult.fee,
        isLateCancellation: feeResult.isLate,
      });

      void ctx.audit({
        action: 'booking.cancel',
        resourceType: 'booking',
        resourceId: bookingId,
      });

      // Post-response cancellation email — `after()` keeps the task alive
      // past response flush on Cloudflare Workers.
      after(async () => {
        try {
          const riderMember = await getMemberById(ctx.clubId, existing.riderMemberId);
          if (!riderMember?.email) return;

          const feeDisplay = feeResult.fee > 0
            ? formatMoney(feeResult.fee, existing.currency)
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
