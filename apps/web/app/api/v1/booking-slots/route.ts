import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createBookingSlotSchema } from '@equestrian/shared/schemas';
import { isDateInPast } from '@equestrian/shared/utils';
import { getBookingSlotsByClub, createBookingSlot } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';

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

      const data = await getBookingSlotsByClub(ctx.clubId, filters);

      return successResponse(data);
    },
    { requiredPermission: 'bookings:read' },
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

      const slot = await createBookingSlot(ctx.clubId, data);

      if (!slot) {
        return errorResponse('CREATE_FAILED', 'Failed to create booking slot', 500);
      }

      return successResponse(slot, 201);
    },
    { requiredPermission: 'bookings:create' },
  );
}
