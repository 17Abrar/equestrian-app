import { type NextRequest } from 'next/server';
import { getLiveryInvoicesByHorse } from '@equestrian/db/queries';
import { withAuth, parsePagination, paginatedListResponse, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Lists livery invoices for a horse. Admin-only — owners see their own
 * invoices via `/api/v1/me/livery-invoices` (below).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getLiveryInvoicesByHorse(ctx.clubId, horseId, {
        page,
        pageSize,
      });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'horses:read' },
  );
}
