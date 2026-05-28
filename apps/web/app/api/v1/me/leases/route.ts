import { type NextRequest } from 'next/server';
import { listLeasesForLesseeUser } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

/**
 * GET /api/v1/me/leases — cross-club lessee view. Returns every
 * lease where the authenticated user is the lessee, across every
 * club they have an active membership in. Mirrors `/me/horses` in
 * spirit (Clerk-user-scoped, soft-deleted clubs excluded).
 *
 * No permission check: this is a user reading their own arrangement
 * roster. Tenant scoping is enforced by `clerkUserId` matching on
 * the underlying `club_members` join.
 */
export async function GET(_request: NextRequest) {
  return withAuth(async (ctx) => {
    const leases = await listLeasesForLesseeUser(ctx.userId);
    return successResponse({ leases });
  });
}
