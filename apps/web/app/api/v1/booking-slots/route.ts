import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createBookingSlotSchema } from '@equestrian/shared/schemas';
import { isDateInPast } from '@equestrian/shared/utils';
import {
  getBookingSlotsByClub,
  createBookingSlot,
  getArenaById,
  getLessonTypeById,
  getMemberById,
} from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const bookingSlotFiltersSchema = z.object({
  date: z.string().regex(datePattern, 'Date must be YYYY-MM-DD format').optional(),
  dateFrom: z.string().regex(datePattern, 'dateFrom must be YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(datePattern, 'dateTo must be YYYY-MM-DD format').optional(),
  lessonTypeId: z.string().uuid('Invalid lesson type ID').optional(),
  coachMemberId: z.string().uuid('Invalid coach member ID').optional(),
});

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(bookingSlotFiltersSchema, searchParams);

      // Riders can view available slots (needed to book), staff can view all
      const canViewSlots = hasPermission(ctx.orgRole, 'bookings:read')
        || hasPermission(ctx.orgRole, 'bookings:create')
        || hasPermission(ctx.orgRole, 'bookings:read_own');

      if (!canViewSlots) {
        return errorResponse('FORBIDDEN', 'You do not have permission to view booking slots', 403);
      }

      const data = await getBookingSlotsByClub(ctx.clubId, filters);

      return successResponse(data);
    },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createBookingSlotSchema, body);

      // Resolve the club's timezone for accurate date comparison
      const clubRow = await db
        .select({ timezone: clubs.timezone })
        .from(clubs)
        .where(eq(clubs.id, ctx.clubId))
        .limit(1);

      const timezone = clubRow[0]?.timezone ?? 'Asia/Dubai';

      if (isDateInPast(data.date, timezone)) {
        return errorResponse(
          'INVALID_DATE',
          'Cannot create booking slots for past dates',
          422,
        );
      }

      // lessonTypeId / arenaId / coachMemberId reference tables that have no
      // compound (id, club_id) FK, so a forged UUID from another club would
      // otherwise insert cleanly and surface that club's lesson type / arena
      // / coach name to riders here. Verify all three are scoped to the
      // caller's club. (audit A-2)
      const lessonType = await getLessonTypeById(ctx.clubId, data.lessonTypeId);
      if (!lessonType) {
        return errorResponse('INVALID_LESSON_TYPE', 'Lesson type not found in this club', 400);
      }
      if (data.arenaId) {
        const arena = await getArenaById(ctx.clubId, data.arenaId);
        if (!arena) return errorResponse('INVALID_ARENA', 'Arena not found in this club', 400);
      }
      if (data.coachMemberId) {
        const coach = await getMemberById(ctx.clubId, data.coachMemberId);
        if (!coach) return errorResponse('INVALID_COACH', 'Coach not found in this club', 400);
      }

      const slot = await createBookingSlot(ctx.clubId, data);

      if (!slot) {
        return errorResponse('CREATE_FAILED', 'Failed to create booking slot', 500);
      }

      void ctx.audit({
        action: 'booking_slot.create',
        resourceType: 'booking_slot',
        resourceId: slot.id,
      });

      return successResponse(slot, 201);
    },
    // `bookings:create` is held by riders so they can self-book lessons;
    // creating slots is staff configuration. Use the wildcard-matched
    // `bookings:update` (admin/manager only).
    { requiredPermission: 'bookings:update' },
  );
}
