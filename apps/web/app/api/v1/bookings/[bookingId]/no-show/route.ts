import React from 'react';
import { type NextRequest, after } from 'next/server';
import {
  getBookingById,
  getBookingSlotById,
  getClubById,
  markBookingNoShow,
  getMemberById,
} from '@equestrian/db/queries';
import { calculateNoShowFee, formatMoney } from '@equestrian/shared/utils';
import {
  withAuth,
  successResponse,
  errorResponse,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { sendTriggeredEmail } from '@/lib/email';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;

      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      if (booking.status !== 'confirmed') {
        return errorResponse(
          'INVALID_STATUS',
          `Cannot mark a ${booking.status} booking as no-show`,
          422,
        );
      }

      // Fetch slot and club for fee calculation
      const [slot, club] = await Promise.all([
        getBookingSlotById(ctx.clubId, booking.slotId),
        getClubById(ctx.clubId),
      ]);

      if (!slot || !club) {
        return errorResponse('NOT_FOUND', 'Slot or club not found', 404);
      }

      // Audit HIGH-12 (2026-05-05): no-show fee must compute against the
      // NET amount the rider actually owes (`booking.amount`), not the
      // sticker price — same fix shape as CRIT-2's cancel-preview/cancel
      // unification. Cap the result at `booking.amount` so a future
      // misconfigured percent can never overcharge.
      const feeBase = booking.amount ?? slot.lessonTypePrice;
      const rawFee = calculateNoShowFee({
        noShowFeePercent: Number(club.noShowFeePercent),
        lessonPrice: feeBase,
      });
      const noShowFee =
        booking.amount != null ? Math.min(rawFee, booking.amount) : rawFee;

      const updated = await markBookingNoShow(ctx.clubId, bookingId, noShowFee);

      if (!updated) {
        return errorResponse('UPDATE_FAILED', 'Failed to mark booking as no-show', 500);
      }

      logger.info('booking_no_show', {
        requestId: ctx.requestId,
        bookingId,
        clubId: ctx.clubId,
        markedBy: ctx.memberId,
        noShowFee,
      });

      void ctx.audit({
        action: 'booking.no_show',
        resourceType: 'booking',
        resourceId: bookingId,
      });

      // Post-response no-show email — `after()` keeps the task alive past
      // response flush on Cloudflare Workers.
      after(async () => {
        try {
          const riderMember = await getMemberById(ctx.clubId, booking.riderMemberId);
          if (!riderMember?.email) return;

          await sendTriggeredEmail({
            clubId: ctx.clubId,
            trigger: 'booking_cancellation',
            to: riderMember.email,
            subject: `No-Show Recorded — ${booking.lessonTypeName}`,
            template: React.createElement(BookingCancellation, {
              riderName: booking.riderName ?? riderMember.displayName ?? '',
              lessonType: booking.lessonTypeName,
              date: String(booking.slotDate),
              time: String(booking.slotStartTime),
              arena: booking.arenaName ?? 'Arena',
              clubName: club.name,
              cancellationFee: noShowFee > 0 ? formatMoney(noShowFee, booking.currency) : undefined,
              type: 'no_show',
            }),
          });
        } catch (err) {
          // Non-fatal for the request, but tag it for the alert rule.
          logger.error('email_send_failed', {
            trigger: 'no_show',
            bookingId,
            clubId: ctx.clubId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });

      return successResponse(updated);
    },
    { requiredPermission: 'bookings:update' },
  );
}
