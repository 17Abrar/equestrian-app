import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getBookingSlotById, updateBookingSlot, cancelBookingSlot } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
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
      } catch {
        // Body is optional for DELETE
      }

      const slot = await cancelBookingSlot(ctx.clubId, slotId, reason);

      if (!slot) {
        return errorResponse('NOT_FOUND', 'Slot not found', 404);
      }

      logger.info('slot_cancelled', { slotId, clubId: ctx.clubId, reason });

      return successResponse({ id: slot.id, message: 'Slot cancelled' });
    },
    { requiredPermission: 'bookings:update' },
  );
}
