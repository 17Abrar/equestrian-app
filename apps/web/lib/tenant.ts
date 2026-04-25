import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { type UserRole } from '@equestrian/shared/types';
import { mapClerkRoleToAppRole } from './clerk-roles';
import { logger } from './logger';

/**
 * Cookie name for the rider's explicitly-chosen active club. When a rider
 * belongs to multiple stables, they can switch via the nav dropdown; that
 * writes this cookie and the next request resolves to the chosen club.
 * Absent → fall back to most-recently-joined (current default behavior).
 */
export const ACTIVE_CLUB_COOKIE = 'cavaliq_active_club';

interface TenantContext {
  clubId: string;
  memberId: string | null;
  userId: string;
  orgId: string;
  orgRole: UserRole;
  onboardingCompleted: boolean;
}

/**
 * Resolves the active tenant for the current request.
 *
 * Two resolution paths, in order:
 *
 * 1. **Clerk active org** — `auth()` returns an `orgId`. Used by admins who
 *    onboarded via the wizard (which creates a Clerk Organization). The club
 *    is looked up by `clubs.clerk_org_id`.
 *
 * 2. **Club-members fallback** — no active Clerk org. Used by riders who
 *    joined a club via `/discover` (that flow inserts a `club_members` row
 *    but does NOT create a Clerk Org membership, since Cavaliq's
 *    authoritative tenancy is `club_members`, not Clerk Orgs). The most
 *    recently joined active membership is used. A future multi-club switcher
 *    will override this via a cookie.
 *
 * Throws `NO_ORGANIZATION` only when the user has NO active membership at all
 * — i.e., they just signed up and haven't joined or started a club yet.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    throw new TenantError('UNAUTHORIZED', 'Authentication required');
  }

  // Path 1 — Clerk active org. If a club is paired with this orgId, use it.
  if (orgId) {
    const club = await db
      .select({ id: clubs.id, onboardingCompletedAt: clubs.onboardingCompletedAt })
      .from(clubs)
      .where(eq(clubs.clerkOrgId, orgId))
      .limit(1);

    const foundClub = club[0];
    if (foundClub) {
      const member = await db
        .select({ id: clubMembers.id, role: clubMembers.role })
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, foundClub.id),
            eq(clubMembers.clerkUserId, userId),
            eq(clubMembers.isActive, true),
          ),
        )
        .limit(1);

      const foundMember = member[0];

      const appRole: UserRole = foundMember
        ? foundMember.role
        : orgRole
          ? mapClerkRoleToAppRole(orgRole)
          : 'rider';

      return {
        clubId: foundClub.id,
        memberId: foundMember?.id ?? null,
        userId,
        orgId,
        orgRole: appRole,
        onboardingCompleted: !!foundClub.onboardingCompletedAt,
      };
    }

    // No club paired with this orgId. Don't 500 here — fall through to the
    // club_members fallback. The user might be an active member of OTHER
    // clubs (e.g. they joined a stable as a rider via /discover, while
    // their Clerk session sits on a legacy/personal org with no paired
    // club). Path 2 will resolve them via memberships, and if they have
    // none, surface NO_ORGANIZATION (which the layouts already handle by
    // redirecting to /rider's empty state).
    logger.warn('tenant_org_no_club_falling_through', { userId, orgId });
  }

  // Path 2 — club_members fallback for riders who joined via /discover.
  // Load all active memberships so we can honor the active-club cookie (if set)
  // and fall back to most-recently-joined otherwise. The extra rows are a few
  // hundred bytes at most.
  const memberships = await db
    .select({
      memberId: clubMembers.id,
      clubId: clubMembers.clubId,
      role: clubMembers.role,
      clerkOrgId: clubs.clerkOrgId,
      onboardingCompletedAt: clubs.onboardingCompletedAt,
    })
    .from(clubMembers)
    .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
    .where(
      and(
        eq(clubMembers.clerkUserId, userId),
        eq(clubMembers.isActive, true),
      ),
    )
    .orderBy(desc(clubMembers.joinedAt));

  if (memberships.length === 0) {
    throw new TenantError('NO_ORGANIZATION', 'No organization selected. Please select a club.');
  }

  const cookieStore = await cookies();
  const activeClubCookie = cookieStore.get(ACTIVE_CLUB_COOKIE)?.value;

  // Cookie wins if the user is actually a member of the chosen club; otherwise
  // silently fall through to most-recent-joined. A stale cookie (user left a
  // stable, membership deactivated, etc.) shouldn't lock them out.
  const chosen = activeClubCookie
    ? memberships.find((m) => m.clubId === activeClubCookie)
    : undefined;
  const primary = chosen ?? memberships[0]!;

  // If the cookie pointed somewhere the user no longer belongs, rewrite it to
  // the fallback club. Two reasons: (a) the next request gets a direct cookie
  // match instead of falling through this branch again, and (b) UI code that
  // reads the cookie client-side won't still be advertising the stale club.
  // `cookieStore.set` is only supported inside a Route Handler/Server Action
  // context, so wrap in a try/catch — RSC contexts will throw and we just
  // leave the cookie as-is (the server branch still resolves correctly).
  if (activeClubCookie && !chosen) {
    try {
      cookieStore.set(ACTIVE_CLUB_COOKIE, primary.clubId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
    } catch {
      // RSC read-only context — next mutation (e.g. /me/active-club POST)
      // will correct the cookie. Safe to ignore.
    }
  }

  return {
    clubId: primary.clubId,
    memberId: primary.memberId,
    userId,
    // orgId stored in the context is used for audit metadata. Prefer a real
    // Clerk org id when present, fall back to the club UUID so the field is
    // never empty.
    orgId: primary.clerkOrgId ?? primary.clubId,
    orgRole: primary.role,
    onboardingCompleted: !!primary.onboardingCompletedAt,
  };
}

export async function withTenantContext<T>(
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
  const ctx = await getTenantContext();
  return fn(ctx);
}

export class TenantError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TenantError';
  }
}
