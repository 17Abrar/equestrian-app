import React from 'react';
import { type NextRequest, NextResponse, after } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import {
  getPublicClubBySlug,
  joinClubInstantly,
  createAuditEntry,
  ensureRiderProfileForMember,
  getMemberByClerkUserAndClub,
} from '@equestrian/db/queries';
import { successResponse, errorResponse } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendTriggeredEmail } from '@/lib/email';
import { WelcomeRider } from '@equestrian/email-templates/welcome-rider';
import { ACTIVE_CLUB_COOKIE } from '@/lib/tenant';
import { ACTIVE_CLUB_COOKIE_TTL_SECONDS } from '@equestrian/shared/constants';

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

    const existingMember = await getMemberByClerkUserAndClub(userId, club.id);
    if (existingMember) {
      if (existingMember.role === 'rider') {
        await ensureRiderProfileForMember(club.id, existingMember.id);
      }
      return successResponse({
        status: 'already_member',
        clubId: club.id,
        slug: club.slug,
        memberId: existingMember.id,
      });
    }

    const clerkUser = await currentUser();
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    const displayName =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
      clerkUser?.username ||
      null;

    const result = await joinClubInstantly({
      clubId: club.id,
      clerkUserId: userId,
      email,
      displayName,
    });

    // Audit J-1: an admin-deactivated rider can't rejoin via this path.
    // The query left the row inactive; surface as 403 with a customer-
    // service message so the rider doesn't loop on retry.
    if (result.status === 'kicked') {
      logger.warn('rider_join_refused_admin_deactivated', {
        clubId: club.id,
        slug: club.slug,
        userId,
      });
      // Audit r5 F-8 (2026-05-07): record the refusal in the audit table
      // so compliance/IR can correlate Clerk login activity with admin-
      // deactivation events. Fire-and-forget; the response below proceeds
      // regardless of audit-write success.
      if (result.memberId) {
        void createAuditEntry({
          clubId: club.id,
          actorMemberId: result.memberId,
          action: 'club_member.join_refused_deactivated',
          resourceType: 'club_member',
          resourceId: result.memberId,
        });
      }
      return errorResponse(
        'JOIN_REFUSED',
        'Your membership at this stable was previously cancelled. Please contact the stable directly to be reinstated.',
        403,
      );
    }

    const { member } = result;

    logger.info('rider_joined_club_instantly', {
      clubId: club.id,
      slug: club.slug,
      memberId: member.id,
    });

    // Audit r5 F-8 (2026-05-07): membership creation is a tenant-mutating
    // action — grants Clerk identity access to bookings, horses, finances.
    // The audit-log retention window (90 days) requires this row so an IR
    // investigation weeks later can answer "when did they become a member."
    void createAuditEntry({
      clubId: club.id,
      actorMemberId: member.id,
      action: 'club_member.create.self_join',
      resourceType: 'club_member',
      resourceId: member.id,
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

    // Audit F-66 (2026-05-07 r4): set the active-club cookie INLINE on
    // the join response. Previously the client had to make a second
    // POST /me/active-club roundtrip to update the cookie; in between,
    // `getTenantContext` could resolve to a different club via the
    // most-recently-joined fallback, briefly showing the wrong tenant
    // in optimistic UIs. Cookie attributes mirror /me/active-club's.
    const response = successResponse(
      { status: 'joined', clubId: club.id, slug: club.slug, memberId: member.id },
      201,
    );
    response.cookies.set(ACTIVE_CLUB_COOKIE, club.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ACTIVE_CLUB_COOKIE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    logger.error('join_club_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
