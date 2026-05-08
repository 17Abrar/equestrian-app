import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getRevenueReport,
  getLessonPopularityReport,
  getHorseUtilizationReport,
  getCancellationReport,
} from '@equestrian/db/queries';
import { MS_PER_DAY } from '@equestrian/shared/constants';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

// Audit F-47 (2026-05-08 r6): cap the date range to 1 year. Without
// this a malicious admin could hammer
// `?dateFrom=1970-01-01&dateTo=2099-12-31` for a full-table aggregate
// per call. UI filters at most 12 months, so the cap is invisible to
// real users. Mirrors `bookingSlotFiltersSchema` (90d) and
// `calendarFiltersSchema` (90d). Reports range is wider because the
// UI surfaces year-over-year revenue comparisons.
const MAX_REPORT_RANGE_DAYS = 366;

const reportFiltersSchema = z
  .object({
    type: z.enum(['revenue', 'lessons', 'horses', 'cancellations']),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
      return (to - from) / MS_PER_DAY <= MAX_REPORT_RANGE_DAYS;
    },
    { message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days` },
  );

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(reportFiltersSchema, searchParams);

      const range = { dateFrom: filters.dateFrom, dateTo: filters.dateTo };

      switch (filters.type) {
        case 'revenue':
          return successResponse(await getRevenueReport(ctx.clubId, range));
        case 'lessons':
          return successResponse(await getLessonPopularityReport(ctx.clubId, range));
        case 'horses':
          return successResponse(await getHorseUtilizationReport(ctx.clubId, range));
        case 'cancellations':
          return successResponse(await getCancellationReport(ctx.clubId, range));
        default:
          return errorResponse('INVALID_TYPE', 'Unknown report type', 400);
      }
    },
    { requiredPermission: 'reports:read' },
  );
}
