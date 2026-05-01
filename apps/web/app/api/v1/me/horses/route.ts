import { type NextRequest } from 'next/server';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getHorsesOwnedByUser, getActiveMembershipsForUser } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

/**
 * Rider-scoped endpoint — returns every horse the authenticated user owns,
 * across every club they belong to, plus the list of clubs they can
 * register NEW horses at (used to populate the registration form selector).
 *
 * No permission check: any authenticated user can read their own horses.
 * The queries scope strictly by Clerk user ID, so cross-tenant leakage is
 * impossible.
 *
 * Pagination applies to the `horses` list. The `memberships` list is short
 * (one row per club the rider belongs to) and stays unpaginated; clients
 * use it to render the new-horse-registration stable selector.
 */
export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const url = new URL(request.url);
    const { page, pageSize } = validateInput(paginationSchema, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });

    const [horsesResult, memberships] = await Promise.all([
      getHorsesOwnedByUser(ctx.userId, { page, pageSize }),
      getActiveMembershipsForUser(ctx.userId),
    ]);

    return successResponse({
      horses: horsesResult.items,
      memberships,
      pagination: {
        page,
        pageSize,
        total: horsesResult.total,
        totalPages: Math.ceil(horsesResult.total / pageSize),
      },
    });
  });
}
