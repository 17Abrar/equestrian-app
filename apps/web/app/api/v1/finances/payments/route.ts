import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getPaymentsByClub } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput } from '@/lib/api-utils';

// Reuse `paginationSchema` (caps `pageSize` at MAX_PAGE_SIZE) so this
// route can't be coerced into pulling the full payment ledger via
// `?pageSize=999999999`. Audit AI-32f — status restricted to the actual
// enum values; date fields locked to YYYY-MM-DD so a malformed value
// 500s with a 400 instead of crashing the SQL `>=`.
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const paymentFiltersSchema = z
  .object({
    status: z.enum(['pending', 'paid', 'failed', 'refunded', 'partial']).optional(),
    dateFrom: z.string().regex(CALENDAR_DATE_RE, 'dateFrom must be YYYY-MM-DD').optional(),
    dateTo: z.string().regex(CALENDAR_DATE_RE, 'dateTo must be YYYY-MM-DD').optional(),
    ...paginationSchema.shape,
  })
  .strict();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(paymentFiltersSchema, searchParams);

      const { data, total } = await getPaymentsByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'finances:read' },
  );
}
