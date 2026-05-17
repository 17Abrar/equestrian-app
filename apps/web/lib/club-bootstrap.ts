import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq } from 'drizzle-orm';
import { TRIAL_DURATION_DAYS } from '@equestrian/shared/constants';
import { mapClerkRoleToAppRole } from '@/lib/clerk-roles';
import { logger } from '@/lib/logger';

/**
 * Synchronously provisions a `clubs` row and a `club_members` row for a
 * (clerkOrgId, clerkUserId) pair. Mirrors the upsert semantics of the
 * Clerk webhook handler's `organization.created` + `organizationMembership.created`
 * branches, but is callable from a user-driven request path — so we no
 * longer depend on Svix delivery latency before a brand-new club admin
 * can use the app.
 *
 * Eliminates the race that fired the Sentry `TenantError: Your account
 * is being set up` alert at the /onboarding layout: previously
 * /start-club polled /api/v1/me for up to 30s waiting on the webhook,
 * then navigated to /onboarding either way. If the webhook hadn't
 * landed yet, the layout's `getTenantContext()` threw NO_MEMBERSHIP
 * unhandled. Now /start-club calls this function via /api/v1/clubs/
 * bootstrap and the layout only loads after the rows exist.
 *
 * Idempotent against three concurrent paths writing the same rows:
 *   1. Svix `organization.created` redelivery
 *   2. Svix `organizationMembership.created` arriving before its sibling
 *   3. This function, called from /api/v1/clubs/bootstrap
 *
 * Each conflict is resolved by re-selecting the existing row. The
 * `(clerk_org_id)` unique on `clubs` and the `(club_id, clerk_user_id)`
 * unique on `club_members` are the authoritative consistency barriers.
 */

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function slugVariants(baseSlug: string): string[] {
  const variants = [baseSlug];
  for (let i = 0; i < 6; i++) {
    // crypto.randomUUID rather than Math.random so an attacker controlling
    // the org name can't predict the next variant. First 4 hex chars keep
    // the slug readable.
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 4);
    variants.push(`${baseSlug}-${suffix}`);
  }
  return variants;
}

export interface BootstrapInput {
  clerkOrgId: string;
  clerkOrgName: string;
  clerkOrgImageUrl: string | null;
  clerkUserId: string;
  clerkRole: string;
  displayName: string | null;
  email: string | null;
}

export interface BootstrapResult {
  clubId: string;
  memberId: string;
  clubSlug: string;
  /** 'created' if this call inserted, 'existed' if a prior write (webhook or duplicate call) had already populated the rows. */
  clubAction: 'created' | 'existed';
  memberAction: 'created' | 'existed';
}

export class ClubBootstrapError extends Error {
  constructor(
    public code: 'SLUG_EXHAUSTED' | 'INSERT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ClubBootstrapError';
  }
}

export async function bootstrapClubAndMembership(input: BootstrapInput): Promise<BootstrapResult> {
  const { clerkOrgId, clerkOrgName, clerkOrgImageUrl, clerkUserId, clerkRole, displayName, email } =
    input;

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DURATION_DAYS);

  const baseSlug = generateSlug(clerkOrgName);
  let club: { id: string; slug: string } | undefined;
  let clubAction: 'created' | 'existed' = 'existed';

  for (const candidate of slugVariants(baseSlug)) {
    const rows = await db
      .insert(clubs)
      .values({
        name: clerkOrgName,
        slug: candidate,
        clerkOrgId,
        logoUrl: clerkOrgImageUrl,
        subscriptionTier: 'trial',
        subscriptionStatus: 'trialing',
        trialEndsAt,
      })
      .onConflictDoNothing()
      .returning({ id: clubs.id, slug: clubs.slug });

    if (rows.length > 0) {
      club = rows[0];
      clubAction = 'created';
      break;
    }

    // Conflict. Two reasons:
    //   (a) The slug is taken by an unrelated club — try the next variant.
    //   (b) The clerk_org_id is taken — Svix redelivery or a concurrent
    //       bootstrap call beat us here. Find the existing row and use it.
    const existingForOrg = await db
      .select({ id: clubs.id, slug: clubs.slug })
      .from(clubs)
      .where(eq(clubs.clerkOrgId, clerkOrgId))
      .limit(1);
    if (existingForOrg[0]) {
      club = existingForOrg[0];
      break;
    }
  }

  if (!club) {
    logger.error('club_bootstrap_slug_exhausted', { clerkOrgId, baseSlug });
    throw new ClubBootstrapError(
      'SLUG_EXHAUSTED',
      'Could not allocate a club slug after 7 attempts.',
    );
  }

  const role = mapClerkRoleToAppRole(clerkRole);

  // `onConflictDoUpdate` on the (club_id, clerk_user_id) unique. Active=true
  // intentionally — re-bootstrapping a previously-deactivated membership
  // is NOT possible via this path because the route handler that calls us
  // only runs when an authenticated user is the org admin in their *current*
  // Clerk session. A deactivated user whose Clerk session was retained
  // would still have orgRole, but Clerk also removes the org membership
  // (see `removeClerkOrgMembership`) on deactivation, so they cannot reach
  // here with the same orgId paired in the JWT.
  const memberRows = await db
    .insert(clubMembers)
    .values({
      clubId: club.id,
      clerkUserId,
      role,
      displayName: displayName ?? undefined,
      email: email ?? undefined,
    })
    .onConflictDoUpdate({
      target: [clubMembers.clubId, clubMembers.clerkUserId],
      set: {
        role,
        displayName: displayName ?? undefined,
        email: email ?? undefined,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: clubMembers.id });

  const member = memberRows[0];
  if (!member) {
    logger.error('club_bootstrap_member_insert_returned_empty', {
      clerkOrgId,
      clerkUserId,
      clubId: club.id,
    });
    throw new ClubBootstrapError(
      'INSERT_FAILED',
      'Membership row insert returned no row — unexpected driver state.',
    );
  }

  // Distinguishing 'created' vs 'existed' for the member row would require
  // a SELECT-then-INSERT pattern (or an `xmax` trick on Postgres). The
  // onConflictDoUpdate path can't differentiate them in a single round-trip;
  // we report 'created' from the caller's perspective (the row is now
  // guaranteed to exist and be active), which is the only guarantee the
  // caller actually needs to proceed.
  return {
    clubId: club.id,
    memberId: member.id,
    clubSlug: club.slug,
    clubAction,
    memberAction: 'created',
  };
}
