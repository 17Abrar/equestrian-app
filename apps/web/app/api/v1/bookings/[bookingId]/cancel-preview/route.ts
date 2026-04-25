import { type NextRequest } from 'next/server';
import { getBookingById, getBookingSlotById, getClubById } from '@equestrian/db/queries';
import { calculateCancellationFee } from '@equestrian/shared/utils';
import {
  withAuth,
  successResponse,
  errorResponse,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;

      // Cancel-preview is a precondition to actually cancelling, so the gate
      // mirrors the DELETE handler in ../route.ts (bookings:cancel_own for
      // riders/parents, bookings:update for staff with broad cancel rights).
      // It does NOT match the read gate on the sibling GET — staff who can
      // read but not cancel (coach, horse_owner) wouldn't act on this data,
      // so we don't surface it.
      const canCancelAny = hasPermission(ctx.orgRole, 'bookings:update');
      const canCancelOwn = hasPermission(ctx.orgRole, 'bookings:cancel_own');

      if (!canCancelAny && !canCancelOwn) {
        return errorResponse('FORBIDDEN', 'You do not have permission to cancel bookings', 403);
      }

      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      // Riders/parents can only preview cancellation for their own bookings.
      if (!canCancelAny && canCancelOwn) {
        if (!ctx.memberId) {
          return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
        }
        if (booking.riderMemberId !== ctx.memberId) {
          return errorResponse('FORBIDDEN', 'You can only cancel your own bookings', 403);
        }
      }

      if (booking.status === 'cancelled') {
        return errorResponse('ALREADY_CANCELLED', 'Booking is already cancelled', 422);
      }

      if (booking.status === 'completed' || booking.status === 'no_show') {
        return errorResponse('NOT_CANCELLABLE', 'This booking cannot be cancelled', 422);
      }

      // Fetch the slot and club settings
      const [slot, club] = await Promise.all([
        getBookingSlotById(ctx.clubId, booking.slotId),
        getClubById(ctx.clubId),
      ]);

      if (!slot || !club) {
        return errorResponse('NOT_FOUND', 'Slot or club not found', 404);
      }

      const feeResult = calculateCancellationFee({
        slotDate: slot.date,
        slotStartTime: slot.startTime,
        timezone: club.timezone,
        cancellationNoticeHours: club.cancellationNoticeHours,
        lateCancellationFeePercent: Number(club.lateCancellationFeePercent),
        lessonPrice: slot.lessonTypePrice,
      });

      return successResponse({
        bookingId: booking.id,
        isLate: feeResult.isLate,
        fee: feeResult.fee,
        currency: booking.currency,
        cutoffTime: feeResult.cutoffTime,
        hoursUntilSlot: Math.round(feeResult.hoursUntilSlot * 10) / 10,
        cancellationNoticeHours: club.cancellationNoticeHours,
        lessonPrice: slot.lessonTypePrice,
      });
    },
  );
}
