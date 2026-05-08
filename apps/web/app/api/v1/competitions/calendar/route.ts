import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCompetitionsForCalendar } from '@equestrian/db/queries';
import { MS_PER_DAY } from '@equestrian/shared/constants';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

const MAX_CALENDAR_RANGE_DAYS = 90;

// Audit F-25 (2026-05-08 r6): `.strict()` so a typo'd query param
// (e.g. `?dateFromm=…`) surfaces as a 400 instead of silently behaving
// as if no filter was supplied. Mirrors `bookingSlotFiltersSchema` and
// the other inline GET filters.
const calendarFiltersSchema = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD'),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD'),
  })
  .strict()
  .refine((d) => d.dateFrom <= d.dateTo, {
    message: 'dateFrom must be on or before dateTo',
  })
  .refine(
    (d) => {
      const from = Date.parse(d.dateFrom);
      const to = Date.parse(d.dateTo);
      if (Number.isNaN(from) || Number.isNaN(to)) return true;
      return (to - from) / MS_PER_DAY <= MAX_CALENDAR_RANGE_DAYS;
    },
    { message: `Date range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days` },
  );

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(calendarFiltersSchema, searchParams);

      const data = await getCompetitionsForCalendar(ctx.clubId, filters.dateFrom, filters.dateTo);

      return successResponse(data);
    },
    { requiredPermission: 'competitions:read' },
  );
}
