import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getRevenueReport,
  getLessonPopularityReport,
  getHorseUtilizationReport,
  getCancellationReport,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

const reportFiltersSchema = z
  .object({
    type: z.enum(['revenue', 'lessons', 'horses', 'cancellations']),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

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
