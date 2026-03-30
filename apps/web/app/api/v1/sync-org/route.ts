import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@equestrian/db';
import { clubs, clubMembers } from '@equestrian/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * One-time sync endpoint to create a club record for the current Clerk organization.
 * Used during development when the webhook wasn't active for existing orgs.
 * Disabled in production.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_AVAILABLE', message: 'This endpoint is not available in production' } },
      { status: 404 },
    );
  }

  try {
    const { userId, orgId, orgRole, orgSlug } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated with an organization' } },
        { status: 401 },
      );
    }

    // Check if club already exists
    const existing = await db
      .select({ id: clubs.id })
      .from(clubs)
      .where(eq(clubs.clerkOrgId, orgId))
      .limit(1);

    if (existing[0]) {
      return NextResponse.json({
        success: true,
        data: { clubId: existing[0].id, message: 'Club already exists' },
      });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    // Create club
    const newClub = await db
      .insert(clubs)
      .values({
        name: orgSlug ?? 'My Club',
        slug: orgSlug ?? `club-${Date.now()}`,
        clerkOrgId: orgId,
        subscriptionTier: 'trial',
        subscriptionStatus: 'trialing',
        trialEndsAt,
      })
      .returning({ id: clubs.id });

    const clubId = newClub[0]?.id;
    if (!clubId) {
      throw new Error('Failed to create club');
    }

    // Create the current user as club_admin
    await db.insert(clubMembers).values({
      clubId,
      clerkUserId: userId,
      role: orgRole === 'org:admin' ? 'club_admin' : 'rider',
    });

    logger.info('org_synced_manually', { clerkOrgId: orgId, clubId });

    return NextResponse.json({
      success: true,
      data: { clubId, message: 'Club and member created' },
    });
  } catch (error) {
    logger.error('sync_org_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to sync organization' } },
      { status: 500 },
    );
  }
}
