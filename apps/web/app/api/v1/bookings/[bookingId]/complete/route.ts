import { type NextRequest } from 'next/server';
import {
  getBookingById,
  markBookingComplete,
} from '@equestrian/db/queries';
import { withAuth,
  successResponse,
  errorResponse, validateUuidParam } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;
      validateUuidParam('bookingId', bookingId);

      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      if (booking.status !== 'confirmed') {
        return errorResponse(
          'INVALID_STATUS',
          `Cannot mark a ${booking.status} booking as completed`,
          422,
        );
      }

      const updated = await markBookingComplete(ctx.clubId, bookingId);

      if (!updated) {
        return errorResponse('UPDATE_FAILED', 'Failed to mark booking as completed', 500);
      }

      logger.info('booking_completed', {
        requestId: ctx.requestId,
        bookingId,
        clubId: ctx.clubId,
        markedBy: ctx.memberId,
      });

      void ctx.audit({
        action: 'booking.complete',
        resourceType: 'booking',
        resourceId: bookingId,
      });

      return successResponse(updated);
    },
    { requiredPermission: 'bookings:update' },
  );
}
