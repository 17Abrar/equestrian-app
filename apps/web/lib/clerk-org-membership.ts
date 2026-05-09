import { clerkClient } from '@clerk/nextjs/server';
import { logger } from './logger';

/**
 * Audit pass-3 (2026-05-09 follow-up A): companion to
 * `deactivateMember`. Removes the (clerkUserId, clerkOrgId) membership
 * from Clerk so the deactivated user's JWT stops carrying their old
 * `org:admin` / `org:member` claim. Without this, the Clerk session
 * keeps the role until its 5-60 minute TTL expires — a deactivated
 * admin who happened to have a tab open could keep running admin
 * operations until expiry.
 *
 * The pass-3 fix in `apps/web/lib/tenant.ts:67-115` is the defense-in-
 * depth complement: the resolver refuses any orgId-paired session
 * lacking an active `club_members` row regardless of JWT `org_role`.
 * Either fix alone closes the window; both together is the proper
 * structural shape — DB is source of truth, Clerk is kept in sync.
 *
 * Fail-open by design: a Clerk outage / 5xx must NOT roll back the
 * DB-side deactivation, because the DB-side fix already closes the
 * security window. The failure is logged at WARN so an operator can
 * follow up — typically with a manual remove from the Clerk
 * dashboard, or a Clerk webhook re-sync — but the deactivate route
 * still reports success to the admin.
 */
export async function removeClerkOrgMembership(args: {
  clerkOrgId: string | null;
  clerkUserId: string | null;
  /** Forensic context — surfaces in the WARN log if the call fails. */
  clubId: string;
  memberId: string;
}): Promise<void> {
  const { clerkOrgId, clerkUserId, clubId, memberId } = args;

  // Manually-created members carry a `manual_${uuid}` placeholder
  // until they actually sign up. They have no Clerk identity yet, so
  // there's nothing to remove.
  if (!clerkOrgId || !clerkUserId || clerkUserId.startsWith('manual_')) {
    return;
  }

  try {
    const clerk = await clerkClient();
    await clerk.organizations.deleteOrganizationMembership({
      organizationId: clerkOrgId,
      userId: clerkUserId,
    });
  } catch (err) {
    logger.warn('clerk_org_membership_removal_failed', {
      clubId,
      memberId,
      clerkOrgId,
      clerkUserId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
