import React from 'react';
import { type NextRequest, after } from 'next/server';
import { z } from 'zod';
import {
  getBookingSlotById,
  updateBookingSlot,
  cancelBookingSlot,
  getMemberById,
  getClubById,
  getArenaById,
} from '@equestrian/db/queries';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';
import { withAuth, successResponse, errorResponse, validateInput, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { sendTriggeredEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

const updateSlotSchema = z
  .object({
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    maxRiders: z.number().int().min(1).optional(),
    arenaId: z.string().uuid().optional(),
    coachMemberId: z.string().uuid().optional(),
  })
  .strict();

// Match `cancelBookingSchema` — cancelling a slot ripple-cancels every
// booking on it, so the rider-facing emails need a meaningful reason.
// The previous shape (`reason` optional, body optional) let staff cancel
// silently while individual booking cancellation required a reason.
const cancelSlotSchema = z
  .object({
    reason: z.string().min(1, 'Cancellation reason is required'),
  })
  .strict();

interface RouteParams {
  params: Promise<{ slotId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit MED (2026-05-05 pass 2): permission gate replicated from
    // the list endpoint. The previous `requiredPermission: 'bookings:read'`
    // 403'd riders / parents / owners — they hold `read_own` /
    // `read_child` / nothing — even though those callers legitimately
    // need slot-detail to deep-link to a booking they own. Mirror the
    // list endpoint's union: staff (`read`), bookers (`create`), and
    // self-readers (`read_own`) all pass; the slot data returned is
    // already public-club-internal (no PII).
    const canViewSlot =
      hasPermission(ctx.orgRole, 'bookings:read') ||
      hasPermission(ctx.orgRole, 'bookings:create') ||
      hasPermission(ctx.orgRole, 'bookings:read_own');

    if (!canViewSlot) {
      return errorResponse('FORBIDDEN', 'You do not have permission to view booking slots', 403);
    }

    const { slotId } = await params;

    validateUuidParam('slotId', slotId);
    const slot = await getBookingSlotById(ctx.clubId, slotId);

    if (!slot) {
      return errorResponse('NOT_FOUND', 'Slot not found', 404);
    }

    return successResponse(slot);
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { slotId } = await params;
      validateUuidParam('slotId', slotId);
      const body = await request.json();
      const data = validateInput(updateSlotSchema, body);

      // Same cross-club guard as the POST routes — neither column has a
      // compound (id, club_id) FK, so a forged UUID would otherwise
      // attach a foreign club's arena/coach to this slot.
      // Audit MED (2026-05-05 pass 2): require the arena to still be
      // active. Editing a slot to point at a deactivated arena would
      // restore the arena into rotation through the back door.
      if (data.arenaId) {
        const arena = await getArenaById(ctx.clubId, data.arenaId, {
          activeOnly: true,
        });
        if (!arena) {
          return errorResponse(
            'INVALID_ARENA',
            'Arena not found, or has been deactivated.',
            400,
          );
        }
      }
      if (data.coachMemberId) {
        const coach = await getMemberById(ctx.clubId, data.coachMemberId);
        if (!coach) return errorResponse('INVALID_COACH', 'Coach not found in this club', 400);
      }

      const result = await updateBookingSlot(ctx.clubId, slotId, data);

      if ('notFound' in result) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }
      if ('cancelled' in result) {
        return errorResponse(
          'SLOT_CANCELLED',
          'This slot has been cancelled and cannot be edited',
          409,
        );
      }

      logger.info('slot_updated', { slotId, clubId: ctx.clubId });

      void ctx.audit({
        action: 'booking_slot.update',
        resourceType: 'booking_slot',
        resourceId: slotId,
      });

      return successResponse(result);
    },
    { requiredPermission: 'bookings:update' },
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { slotId } = await params;
      validateUuidParam('slotId', slotId);

      // A reason is now required (matches cancelBookingSchema). Malformed
      // or missing JSON is a 400 — propagate any error to the withAuth
      // handler so the caller sees the right code instead of silent
      // success with no reason recorded.
      const body = await request.json();
      const data = validateInput(cancelSlotSchema, body);
      const reason = data.reason;

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
                  // Audit F-24 (2026-05-07 r4): rider email + displayName
                  // are now joined inside `cancelBookingSlot` so we don't
                  // fan out N `getMemberById` round-trips here. The query
                  // does not filter on `isActive`, so historical riders
                  // who left the club still receive the cancellation
                  // notice (matches the prior F-30 carve-out).
                  const recipientEmail = booking.guestEmail ?? booking.riderEmail;
                  const riderName = booking.guestEmail
                    ? (booking.guestName ?? 'Guest')
                    : (booking.riderDisplayName ?? '');

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

      // Audit MED-8 (2026-05-05): paid bookings whose slot just got
      // cancelled need refunds. Auto-refunding inside the cascade is
      // feature-sized work (per-booking adapter call, partial-failure
      // handling, idempotency for retries) — not appropriate to bundle
      // into a closeout PR. For now, escalate the signal so an
      // operator definitely sees it: WARN-level structured log with the
      // booking ids so admin tooling can surface a follow-up queue,
      // not just an info-level field on the response that an admin
      // might miss in passing.
      const refundQueue = cancelledBookings
        .filter((b) => b.paymentStatus === 'paid' || b.paymentStatus === 'partial')
        .map((b) => b.id);
      if (refundQueue.length > 0) {
        logger.warn('slot_cancellation_refund_queue_pending', {
          slotId,
          clubId: ctx.clubId,
          bookingIds: refundQueue,
          count: refundQueue.length,
          actorMemberId: ctx.memberId,
        });
      }

      return successResponse({
        id: slot.id,
        message: 'Slot cancelled',
        bookingsCancelled: cancelledBookings.length,
        paidBookingsPendingRefund: refundQueue,
      });
    },
    { requiredPermission: 'bookings:update' },
  );
}
