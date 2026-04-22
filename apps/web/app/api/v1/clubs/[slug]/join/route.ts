import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, currentUser } from '@clerk/nextjs/server';
import {
  getPublicClubBySlug,
  isUserMember,
  hasPendingJoinRequest,
  joinClubInstantly,
  createJoinRequest,
} from '@equestrian/db/queries';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  message: z.string().max(1000).optional(),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * Rider self-signup entry point. Requires an authenticated Clerk session but
 * intentionally does NOT go through `withAuth` — that helper expects the user
 * to already have a tenant context (a club_members row), which is exactly
 * what this endpoint creates.
 *
 * Behavior depends on the target club's `join_policy`:
 *   - open:        instant membership (insert club_members row)
 *   - approval:    creates a club_join_requests row for admin review
 *   - invite_only: 403, must be invited
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    if (club.joinPolicy === 'invite_only') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVITE_ONLY',
            message: 'This club joins by invitation only. Contact the club directly.',
          },
        },
        { status: 403 },
      );
    }

    let parsedBody: z.infer<typeof bodySchema> = {};
    try {
      const raw = await request.json();
      parsedBody = bodySchema.parse(raw);
    } catch {
      // Empty body is fine on an open-policy join.
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

    // Pull name + email from Clerk so admins see who the request is from.
    const clerkUser = await currentUser();
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    const displayName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      null;

    if (club.joinPolicy === 'open') {
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
            error: { code: 'JOIN_FAILED', message: 'Could not add you to the club.' },
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
    }

    // joinPolicy === 'approval'
    if (await hasPendingJoinRequest(club.id, userId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'REQUEST_ALREADY_PENDING',
            message:
              'You already have a pending request to join this club. Please wait for a response.',
          },
        },
        { status: 409 },
      );
    }

    const req = await createJoinRequest({
      clubId: club.id,
      clerkUserId: userId,
      email,
      displayName,
      message: parsedBody.message ?? null,
    });
    if (!req) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'REQUEST_FAILED', message: 'Could not send the join request.' },
        },
        { status: 500 },
      );
    }

    logger.info('rider_join_request_created', {
      clubId: club.id,
      slug: club.slug,
      requestId: req.id,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          status: 'pending',
          clubId: club.id,
          slug: club.slug,
          requestId: req.id,
        },
      },
      { status: 202 },
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
