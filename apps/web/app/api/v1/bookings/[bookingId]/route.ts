import React from 'react';
import { type NextRequest } from 'next/server';
import { cancelBookingSchema } from '@equestrian/shared/schemas';
import { getBookingById, cancelBooking, getMemberById, getClubById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';
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

      const cancelled = await cancelBooking(
        ctx.clubId,
        bookingId,
        data.reason,
        ctx.memberId,
      );

      if (!cancelled) {
        return errorResponse('CANCEL_FAILED', 'Failed to cancel booking', 500);
      }

      logger.info('booking_cancelled', {
        bookingId,
        clubId: ctx.clubId,
        cancelledBy: ctx.memberId,
        reason: data.reason,
      });

      // Fire-and-forget cancellation email — does not block the response
      void Promise.all([
        getMemberById(ctx.clubId, existing.riderMemberId),
        getClubById(ctx.clubId),
      ]).then(([riderMember, club]) => {
        if (!riderMember?.email) return;
        sendEmailAsync({
          to: riderMember.email,
          subject: `Booking Cancelled — ${existing.lessonTypeName}`,
          template: React.createElement(BookingCancellation, {
            riderName: existing.riderName ?? riderMember.displayName ?? '',
            lessonType: existing.lessonTypeName,
            date: String(existing.slotDate),
            time: String(existing.slotStartTime),
            arena: existing.arenaName ?? 'Arena',
            clubName: club?.name ?? '',
            reason: data.reason,
          }),
        });
      }).catch(() => {
        // Email failure is non-fatal — already logged inside sendEmailAsync
      });

      return successResponse(cancelled);
    },
    { requiredPermission: 'bookings:update' },
  );
}
