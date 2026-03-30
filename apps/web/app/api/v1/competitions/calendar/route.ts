import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCompetitionsForCalendar } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

const calendarFiltersSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD'),
});

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
