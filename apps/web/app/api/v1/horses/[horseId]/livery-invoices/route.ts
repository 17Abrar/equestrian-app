import { type NextRequest } from 'next/server';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getLiveryInvoicesByHorse } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput, validateUuidParam } from '@/lib/api-utils';

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
      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getLiveryInvoicesByHorse(ctx.clubId, horseId, {
        page,
        pageSize,
      });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'horses:read' },
  );
}
