import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { addDays, format } from 'date-fns';
import { createRecurringSlotsSchema } from '@equestrian/shared/schemas';
import { isDateInPast } from '@equestrian/shared/utils';
import { createBulkBookingSlots } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createRecurringSlotsSchema, body);

      // Get club timezone
      const clubRow = await db
        .select({ timezone: clubs.timezone })
        .from(clubs)
        .where(eq(clubs.id, ctx.clubId))
        .limit(1);

      const timezone = clubRow[0]?.timezone ?? 'Asia/Dubai';

      if (isDateInPast(data.dateFrom, timezone)) {
        return errorResponse('INVALID_DATE', 'Start date cannot be in the past', 422);
      }

      if (data.dateTo < data.dateFrom) {
        return errorResponse('INVALID_DATE', 'End date must be after start date', 422);
      }

      // Expand days of week + date range into individual slot dates
      const slots: Array<{
        lessonTypeId: string;
        arenaId?: string;
        coachMemberId?: string;
        date: string;
        startTime: string;
        endTime: string;
        maxRiders: number;
      }> = [];

      const startDate = new Date(data.dateFrom);
      const endDate = new Date(data.dateTo);
      let current = startDate;

      while (current <= endDate) {
        const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat
        if (data.daysOfWeek.includes(dayOfWeek)) {
          slots.push({
            lessonTypeId: data.lessonTypeId,
            arenaId: data.arenaId,
            coachMemberId: data.coachMemberId,
            date: format(current, 'yyyy-MM-dd'),
            startTime: data.startTime,
            endTime: data.endTime,
            maxRiders: data.maxRiders,
          });
        }
        current = addDays(current, 1);
      }

      if (slots.length === 0) {
        return errorResponse('NO_SLOTS', 'No slots match the selected days and date range', 422);
      }

      // Safety limit
      if (slots.length > 365) {
        return errorResponse('TOO_MANY_SLOTS', 'Cannot create more than 365 slots at once', 422);
      }

      const created = await createBulkBookingSlots(ctx.clubId, slots);

      logger.info('bulk_slots_created', {
        clubId: ctx.clubId,
        count: created,
        lessonTypeId: data.lessonTypeId,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        daysOfWeek: data.daysOfWeek,
      });

      void ctx.audit({
        action: 'booking_slot.bulk_create',
        resourceType: 'booking_slot',
        changes: {
          count: { from: null, to: created },
          lessonTypeId: { from: null, to: data.lessonTypeId },
          dateFrom: { from: null, to: data.dateFrom },
          dateTo: { from: null, to: data.dateTo },
        },
      });

      return successResponse({ created }, 201);
    },
    { requiredPermission: 'bookings:create' },
  );
}
