import React from 'react';
import { type NextRequest, NextResponse, after } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import {
  getPublicClubBySlug,
  isUserMember,
  joinClubInstantly,
} from '@equestrian/db/queries';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendTriggeredEmail } from '@/lib/email';
import { WelcomeRider } from '@equestrian/email-templates/welcome-rider';

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
      return errorResponse('UNAUTHORIZED', 'Please sign in to join a club', 401);
    }

    // Rate-limit join attempts per user — without this, a signed-in attacker
    // can enumerate slugs (probing 404 vs 200/403) and auto-join every open
    // stable. The route doesn't use `withAuth` so we call checkRateLimit
    // directly. failClosed=true means a Redis outage bounces the user with
    // 429 rather than silently letting the attack through (the legit user's
    // retry costs them nothing).
    const rl = await checkRateLimit(`join:${userId}`, {
      maxRequests: 10,
      windowMs: 60_000,
      failClosed: true,
    });
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
      // `errorResponse` doesn't take custom headers, so build this one
      // by hand — Retry-After is part of the rate-limit contract.
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many join attempts. Try again shortly.' },
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    const { slug } = await params;
    const club = await getPublicClubBySlug(slug);
    if (!club) {
      return errorResponse('NOT_FOUND', 'Club not found', 404);
    }

    // Only two join states now: open (instant) or not-open (403). The old
    // "approval" policy was removed — the user explicitly wanted zero
    // gatekeeping. Any legacy 'approval' value in the DB is treated as
    // invite_only until the admin flips the toggle.
    if (club.joinPolicy !== 'open') {
      return errorResponse(
        'INVITE_ONLY',
        'This stable is private and joins by invitation only. Contact them directly.',
        403,
      );
    }

    if (await isUserMember(club.id, userId)) {
      return successResponse({ status: 'already_member', clubId: club.id, slug: club.slug });
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
      return errorResponse('JOIN_FAILED', 'Could not add you to the stable.', 500);
    }

    logger.info('rider_joined_club_instantly', {
      clubId: club.id,
      slug: club.slug,
      memberId: member.id,
    });

    // Welcome email — respects the club's notification_preferences.
    // Wrapped in `after()` so the send survives response flush on Workers.
    if (email) {
      after(async () => {
        try {
          await sendTriggeredEmail({
            clubId: club.id,
            trigger: 'rider_welcome',
            to: email,
            subject: `Welcome to ${club.name}`,
            template: React.createElement(WelcomeRider, {
              riderName: displayName ?? '',
              clubName: club.name,
            }),
          });
        } catch (err) {
          // Non-fatal for the request, but Sentry needs to see it under
          // the right `logger.event` tag so the alert rule fires.
          logger.error('email_send_failed', {
            trigger: 'rider_welcome',
            clubId: club.id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });
    }

    return successResponse(
      { status: 'joined', clubId: club.id, slug: club.slug, memberId: member.id },
      201,
    );
  } catch (error) {
    logger.error('join_club_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
