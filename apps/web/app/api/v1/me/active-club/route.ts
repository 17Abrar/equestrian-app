import { type NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  errorResponse,
  successResponse,
  validateInput,
  ValidationError,
} from '@/lib/api-utils';
import { ACTIVE_CLUB_COOKIE } from '@/lib/tenant';
import { logger } from '@/lib/logger';

const setActiveClubSchema = z.object({
  clubId: z.string().uuid(),
});

/**
 * Rider-facing stable switcher. Sets a cookie that `getTenantContext()`
 * honors when the user has no active Clerk org. The membership check
 * prevents a forged cookie from granting access to a club the user doesn't
 * belong to (defense in depth — `getTenantContext` also re-checks the cookie
 * against the user's active memberships).
 *
 * Does NOT use `withAuth` because withAuth resolves the tenant context first
 * — and we're trying to CHANGE which tenant is active. We auth via Clerk
 * directly, then write the cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
    }

    // No catch — clubId is required, so an empty/malformed body should
    // surface as 400 INVALID_JSON (via the SyntaxError branch below)
    // rather than as a confusing missing-field validation error.
    const body = await request.json();
    const data = validateInput(setActiveClubSchema, body);

    const membership = await db
      .select({ id: clubMembers.id })
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.clubId, data.clubId),
          eq(clubMembers.clerkUserId, userId),
          eq(clubMembers.isActive, true),
        ),
      )
      .limit(1);

    if (!membership[0]) {
      return errorResponse(
        'NOT_A_MEMBER',
        'You are not a member of this stable',
        403,
      );
    }

    const response = successResponse({ clubId: data.clubId });
    // 30-day cookie; renewed on each switch. Scoped to the whole site so
    // server components and API handlers see it. HttpOnly so client JS can't
    // read it — the client knows its active club via the /me response anyway.
    response.cookies.set(ACTIVE_CLUB_COOKIE, data.clubId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse('VALIDATION_ERROR', error.message, 400, error.details);
    }
    if (error instanceof SyntaxError) {
      return errorResponse('INVALID_JSON', 'Invalid JSON body', 400);
    }
    // This route bypasses withAuth (it CHANGES the active tenant), so it
    // also misses withAuth's unhandled-error logger. A DB outage or Clerk
    // SDK throw would otherwise 500 silently — log explicitly here.
    logger.error('set_active_club_failed', {
      error: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong', 500);
  }
}

/** Clear the cookie — useful for debugging / sign-out. */
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
  }
  const response = successResponse({ cleared: true });
  response.cookies.delete(ACTIVE_CLUB_COOKIE);
  return response;
}
