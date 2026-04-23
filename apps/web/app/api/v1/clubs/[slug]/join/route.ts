import { type NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import {
  getPublicClubBySlug,
  isUserMember,
  joinClubInstantly,
} from '@equestrian/db/queries';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * Rider self-signup entry point. Requires an authenticated Clerk session but
 * intentionally does NOT go through `withAuth` — that helper expects the user
 * to already have a tenant context (a club_members row), which is exactly
 * what this endpoint creates.
 *
 * Behavior: if the club's join_policy is "open", the rider is instantly added
 * as a member (role=rider). Any other policy → 403. The old "approval" flow
 * was removed to eliminate gatekeeping friction.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Please sign in to join a club' },
        },
        { status: 401 },
      );
    }

    const { slug } = await params;
    const club = await getPublicClubBySlug(slug);
    if (!club) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Club not found' } },
        { status: 404 },
      );
    }

    // Only two join states now: open (instant) or not-open (403). The old
    // "approval" policy was removed — the user explicitly wanted zero
    // gatekeeping. Any legacy 'approval' value in the DB is treated as
    // invite_only until the admin flips the toggle.
    if (club.joinPolicy !== 'open') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVITE_ONLY',
            message:
              'This stable is private and joins by invitation only. Contact them directly.',
          },
        },
        { status: 403 },
      );
    }

    if (await isUserMember(club.id, userId)) {
      return NextResponse.json(
        {
          success: true,
          data: { status: 'already_member', clubId: club.id, slug: club.slug },
        },
        { status: 200 },
      );
    }

    const clerkUser = await currentUser();
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    const displayName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      null;

    const member = await joinClubInstantly({
      clubId: club.id,
      clerkUserId: userId,
      email,
      displayName,
    });
    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'JOIN_FAILED', message: 'Could not add you to the stable.' },
        },
        { status: 500 },
      );
    }

    logger.info('rider_joined_club_instantly', {
      clubId: club.id,
      slug: club.slug,
      memberId: member.id,
    });

    return NextResponse.json(
      {
        success: true,
        data: { status: 'joined', clubId: club.id, slug: club.slug, memberId: member.id },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('join_club_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      },
      { status: 500 },
    );
  }
}
