import { type NextRequest } from 'next/server';
import { paginationSchema } from '@equestrian/shared/schemas';
import { listPaymentAccounts } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const url = new URL(request.url);
      const { page, pageSize } = validateInput(paginationSchema, {
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await listPaymentAccounts(ctx.clubId, { page, pageSize });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'settings:read' },
  );
}
