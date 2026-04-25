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
  const body = await request.text();
  const headersList = await headers();

  const svixId = headersList.get('svix-id');
  const svixTimestamp = headersList.get('svix-timestamp');
  const svixSignature = headersList.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn('clerk_webhook_missing_headers');
    return new Response('Missing svix headers', { status: 400 });
  }

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('clerk_webhook_no_secret');
    return new Response('Webhook secret not configured', { status: 503 });
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
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return new Response('Invalid signature', { status: 400 });
  }

  const eventType = event.type;
  logger.info('clerk_webhook_received', { type: eventType });

  // Idempotency layer. Without this, an out-of-order Svix retry of a stale
  // `organizationMembership.updated` (role change to coach) AFTER
  // `organizationMembership.deleted` arrived would re-set both `isActive`
  // and `role` on the member — silently re-activating someone who was
  // just deactivated. svix-id is stable across retries, so it's the right
  // dedup key.
  const claim = await claimWebhookEvent('clerk', svixId);

  if (claim.status === 'already_processed') {
    logger.info('clerk_webhook_duplicate', { type: eventType, svixId });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    // Another worker holds the claim. Return 503 so Svix retries — by then
    // either the in-flight worker has finished (→ already_processed) or
    // the stale window has elapsed and the retry can re-claim.
    logger.info('clerk_webhook_in_flight', { type: eventType, svixId });
    return new Response('Processing in progress', { status: 503 });
  }

  try {
    switch (eventType) {
      case 'organization.created': {
        const orgData = (event as OrganizationEvent).data;
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 30);

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
          logger.warn('clerk_webhook_club_not_found', { clerkOrgId: orgId });
          break;
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
        if (!foundClub) break;

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
        if (!foundClub) break;

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
