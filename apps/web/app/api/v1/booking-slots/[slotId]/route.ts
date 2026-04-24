import React from 'react';
import { type NextRequest, after } from 'next/server';
import { z } from 'zod';
import {
  getBookingSlotById,
  updateBookingSlot,
  cancelBookingSlot,
  getMemberById,
  getClubById,
} from '@equestrian/db/queries';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { sendTriggeredEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

const updateSlotSchema = z.object({
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  maxRiders: z.number().int().min(1).optional(),
  arenaId: z.string().uuid().optional(),
  coachMemberId: z.string().uuid().optional(),
});

const cancelSlotSchema = z.object({
  reason: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ slotId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { slotId } = await params;
      const slot = await getBookingSlotById(ctx.clubId, slotId);

      if (!slot) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }

      return successResponse(slot);
    },
    { requiredPermission: 'bookings:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { slotId } = await params;
      const body = await request.json();
      const data = validateInput(updateSlotSchema, body);

      const slot = await updateBookingSlot(ctx.clubId, slotId, data);

      if (!slot) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }

      logger.info('slot_updated', { slotId, clubId: ctx.clubId });

      void ctx.audit({
        action: 'booking_slot.update',
        resourceType: 'booking_slot',
        resourceId: slotId,
      });

      return successResponse(slot);
    },
    { requiredPermission: 'bookings:update' },
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { slotId } = await params;

      let reason: string | undefined;
      try {
        const body = await request.json();
        const data = validateInput(cancelSlotSchema, body);
        reason = data.reason;
      } catch (err) {
        // Body is optional for DELETE — accept an empty/invalid-JSON request.
        // Any other error (ValidationError with a bad `reason` shape, etc.)
        // should propagate so the caller sees 400 instead of silent success.
        if (!(err instanceof SyntaxError)) throw err;
      }

      // Load the slot's display fields BEFORE cancellation so the email
      // templates have coach/lesson/arena info — the cancellation flips
      // isCancelled but the detail query still returns them.
      const slotDetail = await getBookingSlotById(ctx.clubId, slotId);
      if (!slotDetail) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }

      const result = await cancelBookingSlot(ctx.clubId, slotId, reason);
      if (!result) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }

      const { slot, cancelledBookings } = result;

      logger.info('slot_cancelled', {
        slotId,
        clubId: ctx.clubId,
        reason,
        bookingsCancelled: cancelledBookings.length,
        paidBookingsNeedingRefund: cancelledBookings.filter(
          (b) => b.paymentStatus === 'paid',
        ).length,
      });

      void ctx.audit({
        action: 'booking_slot.cancel',
        resourceType: 'booking_slot',
        resourceId: slotId,
        changes: reason ? { reason: { from: null, to: reason } } : undefined,
      });

      // Fire cancellation emails per-rider after the response flushes.
      // Refunds for paid bookings are NOT auto-issued — the admin reviews
      // the list and clicks Refund per booking (see cancelled-bookings log
      // above for the count needing attention).
      if (cancelledBookings.length > 0) {
        after(async () => {
          try {
            const club = await getClubById(ctx.clubId);
            if (!club) return;

            await Promise.all(
              cancelledBookings.map(async (booking) => {
                try {
                  let recipientEmail: string | null = null;
                  let riderName: string | null = null;

                  if (booking.guestEmail) {
                    recipientEmail = booking.guestEmail;
                    riderName = booking.guestName ?? 'Guest';
                  } else {
                    const member = await getMemberById(
                      ctx.clubId,
                      booking.riderMemberId,
                    );
                    recipientEmail = member?.email ?? null;
                    riderName = member?.displayName ?? '';
                  }

                  if (!recipientEmail) return;

                  await sendTriggeredEmail({
                    clubId: ctx.clubId,
                    trigger: 'booking_cancellation',
                    to: recipientEmail,
                    subject: `Booking Cancelled — ${slotDetail.lessonTypeName}`,
                    template: React.createElement(BookingCancellation, {
                      riderName: riderName ?? '',
                      lessonType: slotDetail.lessonTypeName,
                      date: String(slotDetail.date),
                      time: String(slotDetail.startTime),
                      arena: slotDetail.arenaName ?? 'Arena',
                      clubName: club.name,
                      reason: reason ?? 'The slot has been cancelled',
                    }),
                  });
                } catch (emailErr) {
                  logger.error('slot_cancellation_email_failed', {
                    bookingId: booking.id,
                    clubId: ctx.clubId,
                    error:
                      emailErr instanceof Error ? emailErr.message : String(emailErr),
                  });
                }
              }),
            );
          } catch (err) {
            logger.error('slot_cancellation_email_batch_failed', {
              slotId,
              clubId: ctx.clubId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }

      return successResponse({
        id: slot.id,
        message: 'Slot cancelled',
        bookingsCancelled: cancelledBookings.length,
        paidBookingsPendingRefund: cancelledBookings
          .filter((b) => b.paymentStatus === 'paid')
          .map((b) => b.id),
      });
    },
    { requiredPermission: 'bookings:update' },
  );
}
