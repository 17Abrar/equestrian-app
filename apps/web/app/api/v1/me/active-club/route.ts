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

// Same allowlist the CORS middleware reads. We re-check at the route level
// so a cookie-mutating request from a non-cavaliq origin is refused even
// if Clerk's session validation lets the request through (audit G-18).
// Today Clerk's allowed-origins config catches this for browsers, but the
// extra layer survives a Clerk config change and is cheap.
const CSRF_ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Server-to-server callers (no Origin header — e.g. wrangler dev curl,
    // monitoring probes) are never the CSRF threat model: a browser
    // attacker can't strip Origin from a fetch with credentials. Allow.
    return true;
  }
  // Always-allow the request's own URL origin (handles localhost, preview
  // domains) plus the explicit allowlist for production.
  if (origin === request.nextUrl.origin) return true;
  return CSRF_ALLOWED_ORIGINS.has(origin);
}

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
    if (!isSameOriginRequest(request)) {
      logger.warn('active_club_cross_origin_blocked', {
        origin: request.headers.get('origin'),
      });
      return errorResponse('FORBIDDEN', 'Cross-origin request blocked', 403);
    }

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
  // Explicit expiry instead of `cookies.delete()` — the latter can be flaky
  // under the OpenNext Cloudflare adapter when the cookie was set with a
  // specific path (some adapter versions emit a Set-Cookie without the
  // matching path attribute, leaving the original cookie in place).
  // Setting the same path with maxAge=0 + empty value is the reliable form.
  response.cookies.set(ACTIVE_CLUB_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
