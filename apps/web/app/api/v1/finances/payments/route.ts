import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getPaymentsByClub } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput } from '@/lib/api-utils';

// Reuse `paginationSchema` (caps `pageSize` at 100) so this route can't
// be coerced into pulling the full payment ledger via
// `?pageSize=999999999`. The previous `Number(searchParams.pageSize) || 25`
// path had no upper bound.
const paymentFiltersSchema = z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ...paginationSchema.shape,
});

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
