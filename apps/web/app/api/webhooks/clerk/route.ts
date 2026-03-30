import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq, and } from 'drizzle-orm';
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

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let attempt = 0;

  while (attempt < 10) {
    const existing = await db
      .select({ id: clubs.id })
      .from(clubs)
      .where(eq(clubs.slug, slug))
      .limit(1);

    if (existing.length === 0) {
      return slug;
    }

    attempt++;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${baseSlug}-${suffix}`;
  }

  throw new Error(`Could not generate unique slug for "${baseSlug}"`);
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

  try {
    switch (eventType) {
      case 'organization.created': {
        const orgData = (event as OrganizationEvent).data;
        const slug = await ensureUniqueSlug(generateSlug(orgData.name));
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 30);

        await db.insert(clubs).values({
          name: orgData.name,
          slug,
          clerkOrgId: orgData.id,
          logoUrl: orgData.image_url ?? null,
          subscriptionTier: 'trial',
          subscriptionStatus: 'trialing',
          trialEndsAt,
        });

        logger.info('club_created_from_webhook', { clerkOrgId: orgData.id, slug });
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

    return new Response('OK', { status: 200 });
  } catch (error) {
    logger.error('clerk_webhook_processing_failed', {
      type: eventType,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response('Processing failed', { status: 500 });
  }
}
