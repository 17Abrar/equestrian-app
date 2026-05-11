import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { type UserRole } from '@equestrian/shared/types';
import { logger } from './logger';

/**
 * Cookie name for the rider's explicitly-chosen active club. When a rider
 * belongs to multiple stables, they can switch via the nav dropdown; that
 * writes this cookie and the next request resolves to the chosen club.
 * Absent → fall back to most-recently-joined (current default behavior).
 */
export const ACTIVE_CLUB_COOKIE = 'cavaliq_active_club';

/**
 * Shape of a single active membership exposed through TenantContext. Only
 * populated when `getTenantContext` resolved via the club_members fallback
 * (Path 2) — that path already loads the full membership list to honor the
 * active-club cookie, so re-exposing it lets multi-club consumers (the
 * /me endpoint, the rider stable switcher) skip a second round-trip.
 *
 * Path 1 (Clerk active org) leaves this `undefined`; consumers that need
 * memberships in that case must call `getActiveMembershipsForUser` themselves.
 */
export interface ActiveMembership {
  memberId: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  role: UserRole;
}

interface TenantContext {
  clubId: string;
  memberId: string | null;
  userId: string;
  orgId: string;
  orgRole: UserRole;
  onboardingCompleted: boolean;
  memberships?: ActiveMembership[];
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
  // Audit pass-3 (2026-05-09): `orgRole` from Clerk's session is no
  // longer trusted as a fallback role. Path 1 reads role from the
  // `club_members.role` column (refusing the request if no active
  // membership exists); Path 2 likewise. The value was inviting the
  // deactivation-bypass — see the long comment in Path 1.
  const { userId, orgId } = await auth();

  if (!userId) {
    throw new TenantError('UNAUTHORIZED', 'Authentication required');
  }

  // Path 1 — Clerk active org. If a club is paired with this orgId, use it.
  if (orgId) {
    const club = await db
      .select({ id: clubs.id, onboardingCompletedAt: clubs.onboardingCompletedAt })
      .from(clubs)
      .where(and(eq(clubs.clerkOrgId, orgId), eq(clubs.isActive, true), isNull(clubs.deletedAt)))
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

      // Audit pass-3 (2026-05-09): NEVER fall back to the Clerk-derived
      // role when no active `club_members` row exists. Two scenarios
      // collapsed into one safe outcome:
      //
      //   1. Newly-joined user, Clerk's `organizationMembership.created`
      //      webhook hasn't landed yet → bounded race window, retry-
      //      within-seconds resolves it.
      //   2. Deactivated user whose Clerk session is still live —
      //      `deactivateMember` flips `is_active=false` in our DB but
      //      doesn't (today) call Clerk `removeOrganizationMembership`,
      //      so `orgRole` from the JWT is still 'org:admin' for an
      //      admin who was just revoked. Falling back to that role
      //      grants them admin powers until their JWT TTL elapses —
      //      a real authorization-bypass window. Refusing here closes
      //      the window unconditionally; the corresponding follow-up
      //      is to remove the Clerk org membership at deactivate time
      //      so the JWT itself stops carrying the stale role.
      //
      // Audit auth-5 supersedes: previously fell open to `'rider'` when
      // neither a `club_members` row nor an `orgRole` was present.
      if (!foundMember) {
        throw new TenantError(
          'NO_MEMBERSHIP',
          'Your account is being set up — please refresh in a moment.',
        );
      }

      return {
        clubId: foundClub.id,
        memberId: foundMember.id,
        userId,
        orgId,
        orgRole: foundMember.role,
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
  // and fall back to most-recently-joined otherwise. We also pull name+slug so
  // downstream consumers (the /me endpoint, switcher UI) can render the list
  // without a second round-trip — see TenantContext.memberships.
  const memberships = await db
    .select({
      memberId: clubMembers.id,
      clubId: clubMembers.clubId,
      role: clubMembers.role,
      clubName: clubs.name,
      clubSlug: clubs.slug,
      clerkOrgId: clubs.clerkOrgId,
      onboardingCompletedAt: clubs.onboardingCompletedAt,
    })
    .from(clubMembers)
    .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
    .where(
      and(
        eq(clubMembers.clerkUserId, userId),
        eq(clubMembers.isActive, true),
        eq(clubs.isActive, true),
        isNull(clubs.deletedAt),
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

  // Audit F-32 (2026-05-07 r4): the previous shape silently rewrote
  // the cookie to the fallback club when the cookie's chosen membership
  // was missing from the active-memberships SELECT. Two scenarios trip
  // this branch:
  //   1. The user voluntarily left the chosen club (UI deletion).
  //   2. An admin at the chosen club deactivated the user.
  //
  // For (1) it's harmless. For (2) the silent rewrite means a rider who
  // was kicked out of Club A gets their session moved to Club B with no
  // UI signal — their state changes without consent. Switch from
  // "rewrite to fallback" to "clear the cookie" (`maxAge: 0`). The GET
  // resolver still resolves to the most-recently-joined club for THIS
  // request via `primary = chosen ?? memberships[0]`, but the next
  // request's GET runs without a stale cookie pointer — and the next
  // explicit `/api/v1/me/active-club` POST is what writes a fresh
  // cookie. This makes the cookie a positive signal of user intent,
  // not a hidden derivative of the most recent membership.
  if (activeClubCookie && !chosen) {
    try {
      cookieStore.set(ACTIVE_CLUB_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    } catch (err) {
      // RSC read-only context throws here — that's expected, the next
      // mutation (e.g. /me/active-club POST) will correct the cookie.
      // Logged at debug so the legitimate RSC path doesn't spam Sentry,
      // but a non-RSC failure (e.g. handler crash) is still observable.
      logger.debug('active_club_cookie_clear_skipped', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
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
    memberships: memberships.map((m) => ({
      memberId: m.memberId,
      clubId: m.clubId,
      clubName: m.clubName,
      clubSlug: m.clubSlug,
      role: m.role,
    })),
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
