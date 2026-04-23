import { auth } from '@clerk/nextjs/server';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { type UserRole } from '@equestrian/shared/types';
import { mapClerkRoleToAppRole } from './clerk-roles';

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

  // Path 1 — Clerk active org
  if (orgId) {
    const club = await db
      .select({ id: clubs.id, onboardingCompletedAt: clubs.onboardingCompletedAt })
      .from(clubs)
      .where(eq(clubs.clerkOrgId, orgId))
      .limit(1);

    const foundClub = club[0];
    if (!foundClub) {
      throw new TenantError('CLUB_NOT_FOUND', 'Club not found for this organization.');
    }

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

  // Path 2 — club_members fallback for riders who joined via /discover
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
    .orderBy(desc(clubMembers.joinedAt))
    .limit(1);

  const primary = memberships[0];
  if (!primary) {
    throw new TenantError('NO_ORGANIZATION', 'No organization selected. Please select a club.');
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
