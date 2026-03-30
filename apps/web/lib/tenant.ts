import { auth } from '@clerk/nextjs/server';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and } from 'drizzle-orm';
import { type UserRole } from '@equestrian/shared/types';
import { mapClerkRoleToAppRole } from './clerk-roles';

interface TenantContext {
  clubId: string;
  memberId: string | null;
  userId: string;
  orgId: string;
  orgRole: UserRole;
}

export async function getTenantContext(): Promise<TenantContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    throw new TenantError('UNAUTHORIZED', 'Authentication required');
  }

  if (!orgId) {
    throw new TenantError('NO_ORGANIZATION', 'No organization selected. Please select a club.');
  }

  if (!orgRole) {
    throw new TenantError('NO_ROLE', 'No role assigned in this organization.');
  }

  // Resolve club from Clerk org ID
  const club = await db
    .select({ id: clubs.id })
    .from(clubs)
    .where(eq(clubs.clerkOrgId, orgId))
    .limit(1);

  const foundClub = club[0];
  if (!foundClub) {
    throw new TenantError('CLUB_NOT_FOUND', 'Club not found for this organization.');
  }

  // Get the user's app-level role from club_members (more granular than Clerk roles)
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

  // Fall back to mapping Clerk role if member not found in DB
  const appRole: UserRole = foundMember
    ? foundMember.role
    : mapClerkRoleToAppRole(orgRole);

  return {
    clubId: foundClub.id,
    memberId: foundMember?.id ?? null,
    userId,
    orgId,
    orgRole: appRole,
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
