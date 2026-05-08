import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { createRecurringSlotsSchema } from '@equestrian/shared/schemas';
import { isDateInPast } from '@equestrian/shared/utils';
import {
  createBulkBookingSlots,
  getArenaById,
  getLessonTypeById,
  getMemberById,
} from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, createRecurringSlotsSchema);

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

      // Verify cross-club FKs before fan-out — a single bad UUID would
      // otherwise be repeated on up to 365 inserted rows. lessonTypeId is
      // included alongside arena/coach because lesson_types has the same
      // single-column FK shape (audit A-2).
      // Audit MED (2026-05-05 pass 2): require both to be active —
      // bulk-insert ignoring the soft-delete flag silently restores a
      // dropped arena / lesson type into rotation across up to 365 rows.
      const lessonType = await getLessonTypeById(ctx.clubId, data.lessonTypeId, {
        activeOnly: true,
      });
      if (!lessonType) {
        return errorResponse(
          'INVALID_LESSON_TYPE',
          'Lesson type not found, or has been deactivated.',
          400,
        );
      }
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

      // Audit LOW-8 (2026-05-05): iterate strictly in UTC. `new Date('2026-05-15')`
      // parses to UTC midnight; `getDay()` and date-fns `format()` then render
      // in the SERVER's local timezone — fine on Cloudflare Workers (UTC) but
      // off-by-one for any developer west of UTC running this locally
      // (Pacific: UTC midnight = previous-day 14:00, so Friday becomes
      // Thursday). Use the UTC accessors and format ISO date by slicing the
      // UTC string so the day-of-week match and the rendered `yyyy-MM-dd`
      // both reflect the input's calendar date verbatim.
      const cursor = new Date(`${data.dateFrom}T00:00:00Z`);
      const endDate = new Date(`${data.dateTo}T00:00:00Z`);

      while (cursor <= endDate) {
        const dayOfWeek = cursor.getUTCDay(); // 0=Sun, 6=Sat
        if (data.daysOfWeek.includes(dayOfWeek)) {
          slots.push({
            lessonTypeId: data.lessonTypeId,
            arenaId: data.arenaId,
            coachMemberId: data.coachMemberId,
            date: cursor.toISOString().slice(0, 10),
            startTime: data.startTime,
            endTime: data.endTime,
            maxRiders: data.maxRiders,
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
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
    // Bulk slot creation is staff configuration; `bookings:create` (which
    // riders hold for self-booking) would let any rider mint hundreds of
    // slots. Mirror the single-slot POST and PATCH — admin/manager only.
    { requiredPermission: 'bookings:update' },
  );
}
