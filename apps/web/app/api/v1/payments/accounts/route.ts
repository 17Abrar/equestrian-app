import { type NextRequest } from 'next/server';
import { listPaymentAccounts } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, parsePagination } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await listPaymentAccounts(ctx.clubId, { page, pageSize });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'settings:read' },
  );
}
