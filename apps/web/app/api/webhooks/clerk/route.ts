import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import { logger } from '@/lib/logger';
import { mapClerkRoleToAppRole } from '@/lib/clerk-roles';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';
import { TRIAL_DURATION_DAYS } from '@equestrian/shared/constants';

interface OrganizationEvent {
  data: {
    id: string;
    name: string;
    slug: string;
    image_url?: string;
    created_by?: string;
  };
  type: string;
}

interface MembershipEvent {
  data: {
    id: string;
    organization: {
      id: string;
    };
    public_user_data: {
      user_id: string;
      first_name?: string;
      last_name?: string;
      identifier?: string;
    };
    role: string;
  };
  type: string;
}

/**
 * Audit F-9 (2026-05-06 r2). Pulls `clerkOrgId` / `clerkUserId` off
 * the verified event payload so post-verify logs carry the identifiers
 * an operator filters Sentry by during incident triage. Both event
 * shapes (organization.* and organizationMembership.*) are handled.
 */
function extractClerkIds(
  event: OrganizationEvent | MembershipEvent,
): { clerkOrgId: string | null; clerkUserId: string | null } {
  if (event.type.startsWith('organizationMembership.')) {
    const m = event as MembershipEvent;
    return {
      clerkOrgId: m.data.organization?.id ?? null,
      clerkUserId: m.data.public_user_data?.user_id ?? null,
    };
  }
  if (event.type.startsWith('organization.')) {
    const o = event as OrganizationEvent;
    return {
      clerkOrgId: o.data.id ?? null,
      clerkUserId: o.data.created_by ?? null,
    };
  }
  return { clerkOrgId: null, clerkUserId: null };
}

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
    // Use crypto.randomUUID for the suffix so an attacker who controls the
    // org name can't predict the next variant from a guessable PRNG seed.
    // Pick the first 4 chars after the dashes to keep slugs short.
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 4);
    variants.push(`${baseSlug}-${suffix}`);
  }
  return variants;
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (err) {
    logger.error('clerk_webhook_unhandled_error', {
      requestId: crypto.randomUUID(),
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response('Internal error', { status: 500 });
  }
}

async function handlePost(request: Request) {
  // Audit F-9 (2026-05-06 r2): generate a requestId at handler entry so
  // every log line — pre-verify and post-verify — carries the same
  // correlation tag. The other webhook handlers (Stripe, Ziina) stamp
  // this consistently; Clerk previously only had svix-id.
  const requestId = crypto.randomUUID();

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.clerk, 'clerk');
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }
  const headersList = await headers();

  const svixId = headersList.get('svix-id');
  const svixTimestamp = headersList.get('svix-timestamp');
  const svixSignature = headersList.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn('clerk_webhook_missing_headers', { requestId });
    return new Response('Missing svix headers', { status: 400 });
  }

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('clerk_webhook_no_secret', { requestId, svixId });
    // Audit F-31 (2026-05-08 r6): 401 (not 503) so svix doesn't enter
    // its 5xx retry band (~24h, 5 attempts). The operator already gets
    // paged via the `clerk_webhook_no_secret` error log; the route is
    // operator-actionable, not transient — retrying without the secret
    // configured just amplifies the alert noise. Mirrors the AI-15
    // unified-rejection pattern.
    return new Response('Webhook secret not configured', { status: 401 });
  }

  let event: OrganizationEvent | MembershipEvent;

  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as OrganizationEvent | MembershipEvent;
  } catch (error) {
    logger.error('clerk_webhook_verification_failed', {
      requestId,
      svixId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return new Response('Invalid signature', { status: 400 });
  }

  const eventType = event.type;
  // Audit F-9: extract `clerkOrgId` / `clerkUserId` from the verified
  // payload so every post-verify log line carries the customer-visible
  // identifiers operators pivot on during incident triage.
  const { clerkOrgId, clerkUserId } = extractClerkIds(event);
  logger.info('clerk_webhook_received', {
    requestId,
    svixId,
    type: eventType,
    clerkOrgId,
    clerkUserId,
  });

  // Idempotency layer. Without this, an out-of-order Svix retry of a stale
  // `organizationMembership.updated` (role change to coach) AFTER
  // `organizationMembership.deleted` arrived would re-set both `isActive`
  // and `role` on the member — silently re-activating someone who was
  // just deactivated. svix-id is stable across retries, so it's the right
  // dedup key.
  const claim = await claimWebhookEvent('clerk', svixId);

  if (claim.status === 'already_processed') {
    logger.info('clerk_webhook_duplicate', {
      requestId,
      svixId,
      type: eventType,
      clerkOrgId,
      clerkUserId,
    });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    // Another worker holds the claim. Return 503 so Svix retries — by then
    // either the in-flight worker has finished (→ already_processed) or
    // the stale window has elapsed and the retry can re-claim.
    logger.info('clerk_webhook_in_flight', {
      requestId,
      svixId,
      type: eventType,
      clerkOrgId,
      clerkUserId,
    });
    return new Response('Processing in progress', { status: 503 });
  }

  if (claim.status === 'permanently_failed') {
    // The event burned through MAX_WEBHOOK_ATTEMPTS retries; further
    // attempts won't help (likely a missing org.created sibling). Return
    // 200 so Svix stops retrying and emit a high-priority alert so an
    // operator runs the org-resync procedure (audit B-12).
    logger.error('webhook_permanently_failed', {
      requestId,
      provider: 'clerk',
      svixId,
      eventType,
      clerkOrgId,
      clerkUserId,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    switch (eventType) {
      case 'organization.created': {
        const orgData = (event as OrganizationEvent).data;
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DURATION_DAYS);

        // Retry-safe against both Svix redeliveries (same clerk_org_id) and
        // concurrent org.created for the same name (same slug). Each INSERT
        // returns the row on conflict-miss and [] on conflict-hit; we walk
        // a short list of slug variants until one commits, then break.
        const baseSlug = generateSlug(orgData.name);
        let inserted: { id: string; slug: string } | undefined;
        for (const candidate of slugVariants(baseSlug)) {
          const rows = await db
            .insert(clubs)
            .values({
              name: orgData.name,
              slug: candidate,
              clerkOrgId: orgData.id,
              logoUrl: orgData.image_url ?? null,
              subscriptionTier: 'trial',
              subscriptionStatus: 'trialing',
              trialEndsAt,
            })
            .onConflictDoNothing()
            .returning({ id: clubs.id, slug: clubs.slug });

          if (rows.length > 0) {
            inserted = rows[0];
            break;
          }

          // Conflict. Distinguish clerk_org_id collision (Svix redelivery —
          // stop, we're done) from slug collision (try the next variant).
          const existingForOrg = await db
            .select({ id: clubs.id, slug: clubs.slug })
            .from(clubs)
            .where(eq(clubs.clerkOrgId, orgData.id))
            .limit(1);
          if (existingForOrg[0]) {
            inserted = existingForOrg[0];
            break;
          }
        }

        if (!inserted) {
          logger.error('club_slug_allocation_exhausted', {
            clerkOrgId: orgData.id,
            baseSlug,
          });
          return new Response('Could not allocate club slug', { status: 500 });
        }

        logger.info('club_created_from_webhook', {
          clerkOrgId: orgData.id,
          slug: inserted.slug,
        });
        break;
      }

      case 'organization.updated': {
        const orgData = (event as OrganizationEvent).data;

        await db
          .update(clubs)
          .set({
            name: orgData.name,
            logoUrl: orgData.image_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(clubs.clerkOrgId, orgData.id));

        logger.info('club_updated_from_webhook', { clerkOrgId: orgData.id });
        break;
      }

      case 'organization.deleted': {
        const orgData = (event as OrganizationEvent).data;

        await db
          .update(clubs)
          .set({
            isActive: false,
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(clubs.clerkOrgId, orgData.id));

        logger.info('club_deleted_from_webhook', { clerkOrgId: orgData.id });
        break;
      }

      case 'organizationMembership.created': {
        const memberData = (event as MembershipEvent).data;
        const orgId = memberData.organization.id;
        const userData = memberData.public_user_data;

        const club = await db
          .select({ id: clubs.id })
          .from(clubs)
          .where(eq(clubs.clerkOrgId, orgId))
          .limit(1);

        const foundClub = club[0];
        if (!foundClub) {
          // Svix delivery is best-effort, not strictly ordered. The
          // membership event can arrive before its `organization.created`
          // sibling. Silently swallowing this here would leave the club
          // with no `club_members` row for the admin who just signed up.
          // Mark the claim as failed so the next Svix retry can re-claim,
          // and return 503 so Svix actually retries instead of treating
          // the 200 as success.
          logger.warn('clerk_webhook_club_not_found', { clerkOrgId: orgId, eventType });
          await markWebhookEventFailed('clerk', svixId, 'club_not_found_retry');
          return new Response('Club not found, retry pending', { status: 503 });
        }

        const displayName = [userData.first_name, userData.last_name]
          .filter(Boolean)
          .join(' ') || undefined;

        await db
          .insert(clubMembers)
          .values({
            clubId: foundClub.id,
            clerkUserId: userData.user_id,
            role: mapClerkRoleToAppRole(memberData.role),
            displayName,
            email: userData.identifier,
          })
          .onConflictDoUpdate({
            target: [clubMembers.clubId, clubMembers.clerkUserId],
            set: {
              role: mapClerkRoleToAppRole(memberData.role),
              displayName,
              email: userData.identifier,
              isActive: true,
              updatedAt: new Date(),
            },
          });

        logger.info('member_created_from_webhook', {
          clerkOrgId: orgId,
          clerkUserId: userData.user_id,
          role: memberData.role,
        });
        break;
      }

      case 'organizationMembership.updated': {
        const memberData = (event as MembershipEvent).data;
        const orgId = memberData.organization.id;

        const club = await db
          .select({ id: clubs.id })
          .from(clubs)
          .where(eq(clubs.clerkOrgId, orgId))
          .limit(1);

        const foundClub = club[0];
        if (!foundClub) {
          // Same race as `created` above. Retry instead of dropping the
          // role change silently.
          logger.warn('clerk_webhook_club_not_found', { clerkOrgId: orgId, eventType });
          await markWebhookEventFailed('clerk', svixId, 'club_not_found_retry');
          return new Response('Club not found, retry pending', { status: 503 });
        }

        await db
          .update(clubMembers)
          .set({
            role: mapClerkRoleToAppRole(memberData.role),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clubMembers.clubId, foundClub.id),
              eq(clubMembers.clerkUserId, memberData.public_user_data.user_id),
            ),
          );

        logger.info('member_updated_from_webhook', {
          clerkOrgId: orgId,
          clerkUserId: memberData.public_user_data.user_id,
        });
        break;
      }

      case 'organizationMembership.deleted': {
        const memberData = (event as MembershipEvent).data;
        const orgId = memberData.organization.id;

        const club = await db
          .select({ id: clubs.id })
          .from(clubs)
          .where(eq(clubs.clerkOrgId, orgId))
          .limit(1);

        const foundClub = club[0];
        if (!foundClub) {
          // Same race as above. Retry instead of leaving the member
          // active in our DB after Clerk has removed them.
          logger.warn('clerk_webhook_club_not_found', { clerkOrgId: orgId, eventType });
          await markWebhookEventFailed('clerk', svixId, 'club_not_found_retry');
          return new Response('Club not found, retry pending', { status: 503 });
        }

        await db
          .update(clubMembers)
          .set({
            isActive: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clubMembers.clubId, foundClub.id),
              eq(clubMembers.clerkUserId, memberData.public_user_data.user_id),
            ),
          );

        logger.info('member_deactivated_from_webhook', {
          clerkOrgId: orgId,
          clerkUserId: memberData.public_user_data.user_id,
        });
        break;
      }

      default:
        logger.info('clerk_webhook_unhandled', { type: eventType });
    }

    await markWebhookEventProcessed('clerk', svixId);
    return new Response('OK', { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await markWebhookEventFailed('clerk', svixId, message);
    logger.error('clerk_webhook_processing_failed', {
      type: eventType,
      svixId,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response('Processing failed', { status: 500 });
  }
}
