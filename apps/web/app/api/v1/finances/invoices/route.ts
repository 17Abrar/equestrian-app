import { type NextRequest } from 'next/server';
import { invoiceFiltersSchema } from '@equestrian/shared/schemas';
import { getInvoicesByClub } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(invoiceFiltersSchema, searchParams);

      const { data, total } = await getInvoicesByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'finances:read' },
  );
}
