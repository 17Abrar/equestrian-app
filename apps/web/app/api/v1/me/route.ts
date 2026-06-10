import { auth } from '@clerk/nextjs/server';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { getClubById, getActiveMembershipsForUser } from '@equestrian/db/queries';
import { logger } from '@/lib/logger';

/**
 * Audit FE (2026-06-07): tolerate the authenticated-but-clubless state.
 *
 * This route previously went through `withAuth`, which maps
 * `getTenantContext`'s NO_ORGANIZATION / NO_ROLE / CLUB_NOT_FOUND to a 400.
 * Result: every newly-signed-up rider who lands on /rider before joining a
 * club generated a red `GET /api/v1/me 400` in the browser console (and a
 * client-side error for `useCurrentUser`). Now those genuinely-clubless cases
 * return 200 with `activeClub: null` so the "find a stable" UI renders cleanly.
 *
 * The other tenant states keep their prior semantics:
 *   - NO_MEMBERSHIP (Clerk webhook race) -> 503 so the client can retry.
 *   - MEMBERSHIP_DEACTIVATED -> 403 (admin removed the user).
 *   - UNAUTHORIZED -> 401.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
  }

  try {
    const ctx = await getTenantContext();
    // Memberships are already loaded by `getTenantContext` on the
    // club_members fallback path (riders who joined via /discover) — reuse
    // them when present. The Clerk-active-org path doesn't load them, so
    // fall back to a direct fetch in that case.
    const [club, memberships] = await Promise.all([
      getClubById(ctx.clubId),
      ctx.memberships ? Promise.resolve(ctx.memberships) : getActiveMembershipsForUser(ctx.userId),
    ]);

    return successResponse({
      userId: ctx.userId,
      memberId: ctx.memberId,
      orgId: ctx.orgId,
      role: ctx.orgRole,
      activeClub: club ? { id: club.id, name: club.name, slug: club.slug } : null,
      memberships,
    });
  } catch (err) {
    if (err instanceof TenantError) {
      // Authenticated but not attached to any club yet -> clubless payload.
      if (
        err.code === 'NO_ORGANIZATION' ||
        err.code === 'NO_ROLE' ||
        err.code === 'CLUB_NOT_FOUND'
      ) {
        // Codex review (2026-06-07): do NOT swallow a membership-query failure
        // as an empty list — that would mask a real DB outage as a clean
        // clubless 200. Surface it as a 500 like the unhandled path below.
        let memberships;
        try {
          memberships = await getActiveMembershipsForUser(userId);
        } catch (membershipErr) {
          logger.error('unhandled_api_error', {
            route: '/api/v1/me',
            error: membershipErr instanceof Error ? membershipErr.message : 'unknown',
            stack: membershipErr instanceof Error ? membershipErr.stack : undefined,
          });
          return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
        }
        return successResponse({
          userId,
          memberId: null,
          orgId: null,
          role: null,
          activeClub: null,
          memberships,
        });
      }
      if (err.code === 'MEMBERSHIP_DEACTIVATED') {
        return errorResponse('FORBIDDEN', err.message, 403);
      }
      if (err.code === 'NO_MEMBERSHIP') {
        return errorResponse('NO_MEMBERSHIP', err.message, 503);
      }
      if (err.code === 'UNAUTHORIZED') {
        return errorResponse('UNAUTHORIZED', err.message, 401);
      }
    }
    // Mirror withAuth's unhandled-error path so real failures stay visible.
    logger.error('unhandled_api_error', {
      route: '/api/v1/me',
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
