import { type NextRequest } from 'next/server';
import { getLiveryInvoicesOwnedByUser } from '@equestrian/db/queries';
import { withAuth, paginatedResponse, parsePagination } from '@/lib/api-utils';

/**
 * Owner's own livery invoices, across every stable they own a horse at.
 * Scoped strictly by Clerk user id so no tenant leakage is possible.
 */
export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { page, pageSize } = parsePagination(request);
    const { items, total } = await getLiveryInvoicesOwnedByUser(ctx.userId, { page, pageSize });
    return paginatedResponse(items, { page, pageSize, total });
  });
}
