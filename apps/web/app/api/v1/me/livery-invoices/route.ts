import { type NextRequest } from 'next/server';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getLiveryInvoicesOwnedByUser } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, validateInput } from '@/lib/api-utils';

/**
 * Owner's own livery invoices, across every stable they own a horse at.
 * Scoped strictly by Clerk user id so no tenant leakage is possible.
 */
export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const url = new URL(request.url);
    const { page, pageSize } = validateInput(paginationSchema, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    const { items, total } = await getLiveryInvoicesOwnedByUser(ctx.userId, { page, pageSize });
    return paginatedResponse(items, { page, pageSize, total });
  });
}
