import { getLiveryInvoicesOwnedByUser } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

/**
 * Owner's own livery invoices, across every stable they own a horse at.
 * Scoped strictly by Clerk user id so no tenant leakage is possible.
 */
export async function GET() {
  return withAuth(async (ctx) => {
    const invoices = await getLiveryInvoicesOwnedByUser(ctx.userId);
    return successResponse(invoices);
  });
}
