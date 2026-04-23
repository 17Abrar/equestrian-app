import { getHorsesOwnedByUser, getActiveMembershipsForUser } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

/**
 * Rider-scoped endpoint — returns every horse the authenticated user owns,
 * across every club they belong to, plus the list of clubs they can
 * register NEW horses at (used to populate the registration form selector).
 *
 * No permission check: any authenticated user can read their own horses.
 * The queries scope strictly by Clerk user ID, so cross-tenant leakage is
 * impossible.
 */
export async function GET() {
  return withAuth(async (ctx) => {
    const [horses, memberships] = await Promise.all([
      getHorsesOwnedByUser(ctx.userId),
      getActiveMembershipsForUser(ctx.userId),
    ]);

    return successResponse({ horses, memberships });
  });
}
