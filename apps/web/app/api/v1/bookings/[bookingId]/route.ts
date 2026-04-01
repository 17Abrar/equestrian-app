import React from 'react';
import { type NextRequest } from 'next/server';
import { cancelBookingSchema } from '@equestrian/shared/schemas';
import { calculateCancellationFee } from '@equestrian/shared/utils';
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
import { sendEmailAsync } from '@/lib/email';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;
      const booking = await getBookingById(ctx.clubId, bookingId);

      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      return successResponse(booking);
    },
    { requiredPermission: 'bookings:read' },
  );
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

      // Fire-and-forget cancellation email — does not block the response
      void getMemberById(ctx.clubId, existing.riderMemberId).then((riderMember) => {
        if (!riderMember?.email) return;

        const feeDisplay = feeResult.fee > 0
          ? `${(feeResult.fee / 100).toFixed(2)} ${existing.currency}`
          : undefined;

        sendEmailAsync({
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
      }).catch(() => {
        // Email failure is non-fatal — already logged inside sendEmailAsync
      });

      return successResponse(cancelled);
    },
  );
}
