import { NextResponse } from 'next/server';
import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { bootstrapClubAndMembership, ClubBootstrapError } from '@/lib/club-bootstrap';
import { logger } from '@/lib/logger';

/**
 * Synchronously provisions the `clubs` + `club_members` rows for the
 * caller's currently-active Clerk organization. Called from /start-club
 * immediately after `createOrganization` + `setActive` so the user
 * arrives at /onboarding with a guaranteed-resolved tenant context.
 *
 * Replaces the legacy 30s poll of /api/v1/me that fired
 * `TenantError: Your account is being set up` Sentry alerts whenever the
 * `organization.created` / `organizationMembership.created` Svix
 * deliveries took longer than the poll deadline.
 *
 * Does NOT use `withAuth` because `withAuth` calls `getTenantContext()`,
 * which throws `NO_MEMBERSHIP` until the rows this endpoint creates
 * exist. Bare `auth()` + `clerkClient()` are the right primitives here:
 * the caller is authenticated by Clerk (their JWT is verified) but the
 * application-layer tenant identity is what we're about to write.
 *
 * Idempotent — safe to call multiple times for the same Clerk org
 * (mirrors the `onConflict` semantics of the Svix webhook handler).
 * Convergent with the webhook: whichever path lands first wins; the
 * other no-ops on the unique constraint.
 */
export async function POST() {
  try {
    const session = await auth();
    const userId = session.userId;
    const orgId = session.orgId;

    if (!userId) {
      return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
    }
    if (!orgId) {
      return errorResponse(
        'NO_ACTIVE_ORG',
        'No active Clerk organization. Create or select one before bootstrapping.',
        400,
      );
    }

    // 10/min/user matches the /clubs/[slug]/join rate limit — same shape
    // (membership-mutating, expensive to misuse). failClosed bounces the
    // user with 429 on a Redis outage rather than letting a flood through.
    const rl = await checkRateLimit(`bootstrap:${userId}`, {
      maxRequests: 10,
      windowMs: 60_000,
      failClosed: true,
    });
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    // Read the org name + image from the Clerk Backend API rather than the
    // request body. The user typed the name on /start-club, but trusting
    // a client-supplied name here would let a session probe rename an
    // existing club by re-POSTing with a different `name`. Clerk's Backend
    // API is the authoritative source for the org's current state, and
    // we already need a server-side hop to verify the user's membership.
    let clerkOrg: { name: string; imageUrl: string | null; role: string };
    try {
      const clerk = await clerkClient();
      const org = await clerk.organizations.getOrganization({ organizationId: orgId });

      // Confirm the caller's role in this org from Clerk's API. We don't
      // trust the JWT `orgRole` claim because it can be 60s stale after
      // a role change; using the live API ensures we map the correct
      // role into `club_members.role` on first write.
      //
      // Pass `userId: [userId]` so Clerk filters server-side. The SDK's
      // unfiltered `getOrganizationMembershipList` defaults to limit=10;
      // for any org with more than 10 members where the caller's row
      // isn't on page 1, an unfiltered list would `.find()` over the
      // wrong page and we'd return a false 403 NOT_ORG_MEMBER to a
      // legitimate member. The userId filter is an exact-match
      // server-side query — O(1) regardless of org size.
      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        userId: [userId],
      });
      const callerMembership = memberships.data.find((m) => m.publicUserData?.userId === userId);
      if (!callerMembership) {
        // User has `orgId` in their JWT but is not actually a member per
        // Clerk's API. Indicates a session that wasn't invalidated after
        // they were removed from the org. Refuse to bootstrap.
        logger.warn('bootstrap_caller_not_org_member', { userId, clerkOrgId: orgId });
        return errorResponse(
          'NOT_ORG_MEMBER',
          'You are not a member of this organization. Refresh and try again.',
          403,
        );
      }

      clerkOrg = {
        name: org.name,
        imageUrl: org.imageUrl ?? null,
        role: callerMembership.role,
      };
    } catch (err) {
      // Clerk API failures here are not user-actionable — surface as 503
      // so the client can retry. The error is logged with full context for
      // operator triage.
      logger.error('bootstrap_clerk_api_failed', {
        userId,
        clerkOrgId: orgId,
        error: err instanceof Error ? err.message : 'unknown',
        stack: err instanceof Error ? err.stack : undefined,
      });
      return errorResponse(
        'CLERK_API_UNAVAILABLE',
        'Could not reach Clerk to verify your organization. Please retry.',
        503,
      );
    }

    // currentUser() gives us the caller's profile from Clerk's session.
    // Used for `club_members.display_name` + `club_members.email` so the
    // member-list UI has data to render on first paint without waiting on
    // the webhook to flesh out the row.
    const clerkUser = await currentUser();
    const displayName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      null;
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;

    let result;
    try {
      result = await bootstrapClubAndMembership({
        clerkOrgId: orgId,
        clerkOrgName: clerkOrg.name,
        clerkOrgImageUrl: clerkOrg.imageUrl,
        clerkUserId: userId,
        clerkRole: clerkOrg.role,
        displayName,
        email,
      });
    } catch (err) {
      if (err instanceof ClubBootstrapError) {
        // `KICKED` means the membership row exists with a non-null
        // `deactivated_by_admin_at` stamp. Surface as 403 with a distinct
        // user-facing message — these users were deliberately removed by
        // a club admin and must NOT be auto-restored via bootstrap.
        // Audit J-1 / pass-3 defense.
        if (err.code === 'KICKED') {
          logger.warn('bootstrap_refused_kicked', {
            userId,
            clerkOrgId: orgId,
          });
          return errorResponse(
            'KICKED',
            'Your membership in this organization was revoked by a club admin. Contact them to be re-invited.',
            403,
          );
        }
        logger.error('bootstrap_failed', {
          userId,
          clerkOrgId: orgId,
          code: err.code,
          error: err.message,
        });
        return errorResponse(
          err.code,
          'Could not finish setting up your club. Please try again.',
          500,
        );
      }
      throw err;
    }

    logger.info('club_bootstrapped', {
      userId,
      clerkOrgId: orgId,
      clubId: result.clubId,
      memberId: result.memberId,
      clubSlug: result.clubSlug,
      clubAction: result.clubAction,
      memberAction: result.memberAction,
    });

    return successResponse(
      {
        clubId: result.clubId,
        memberId: result.memberId,
        slug: result.clubSlug,
      },
      201,
    );
  } catch (error) {
    logger.error('bootstrap_unhandled_error', {
      error: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
