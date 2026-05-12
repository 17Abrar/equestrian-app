import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendPlainTextEmailWithRetry } from '@/lib/email';
import { logger } from '@/lib/logger';

// Plain-text only — no `html` field. A compromised staff account can
// already use this endpoint to spam every member of their club, but
// accepting raw HTML would let them mount more convincing phishing
// templates served from the club's verified Resend domain. If we ever
// need rich content, add a server-side allowlist (DOMPurify) — never
// pass through caller-supplied HTML.
const sendEmailSchema = z
  .object({
    to: z.string().email('Invalid email address'),
    subject: z.string().min(1, 'Subject is required').max(500),
    body: z.string().min(1, 'Body is required').max(20_000),
  })
  .strict();

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, sendEmailSchema);

      // Recipient must be an active member of THIS club. Without this check
      // the endpoint is a spam relay backed by the club's Resend quota —
      // a compromised staff account could blast the verified `From` domain
      // at any address on the internet.
      const recipient = await db
        .select({ id: clubMembers.id })
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, ctx.clubId),
            sql`lower(${clubMembers.email}) = lower(${data.to})`,
            eq(clubMembers.isActive, true),
          ),
        )
        .limit(1);

      if (!recipient[0]) {
        return errorResponse(
          'RECIPIENT_NOT_A_MEMBER',
          'You can only email active members of this club.',
          403,
        );
      }

      // Per-recipient cool-down (audit QA-23) — same recipient can't be
      // hit by the same club more than once per 60s, regardless of which
      // staff member sent it. Bounds the blast radius of a compromised
      // admin and protects against accidental loops in front-end code.
      // Audit LOW (2026-05-06): failClosed for the spam-relay surface.
      // Without this, an Upstash outage drops the limiter to per-isolate
      // in-memory counters (see `lib/rate-limit.ts:163-194`), and a
      // compromised admin token + outage = a brief window of unbounded
      // sends from the club's verified Resend domain. failClosed makes
      // the outage page rather than degrade silently.
      const recipientLimit = await checkRateLimit(
        `email:recipient:${ctx.clubId}:${data.to.toLowerCase()}`,
        { maxRequests: 1, windowMs: 60_000, failClosed: true },
      );
      if (!recipientLimit.allowed) {
        return errorResponse(
          'RECIPIENT_RATE_LIMITED',
          `Recipient was contacted recently; try again in a minute.`,
          429,
        );
      }

      // Per-club daily cap (audit QA-23) — bound the blast radius of a
      // compromised admin to 500 sends/day per club.
      const clubDay = await checkRateLimit(`email:club_day:${ctx.clubId}`, {
        maxRequests: 500,
        windowMs: 24 * 60 * 60_000,
        failClosed: true,
      });
      if (!clubDay.allowed) {
        return errorResponse(
          'CLUB_DAILY_CAP',
          'Club has reached the daily 500-email cap; resumes tomorrow.',
          429,
        );
      }

      try {
        const result = await sendPlainTextEmailWithRetry({
          to: data.to,
          subject: data.subject,
          text: data.body,
        });

        if (!result.sent) {
          logger.error('email_send_failed', {
            clubId: ctx.clubId,
            to: data.to,
            subject: data.subject,
            error: result.error,
          });
          if (
            result.error === 'Email not configured' ||
            result.error === 'EMAIL_FROM not configured in production'
          ) {
            return errorResponse('EMAIL_NOT_CONFIGURED', 'Email service is not configured.', 503);
          }
          return errorResponse('EMAIL_FAILED', 'Failed to send email', 500);
        }

        logger.info('email_sent', {
          clubId: ctx.clubId,
          to: data.to,
          subject: data.subject,
          resendId: result.id,
        });

        // Audit F-18 (2026-05-08 r6): persist a structured audit row so
        // an "I never asked for that email" support ticket is reconstructible
        // from the database. The recipient's `clubMembers.id` was already
        // resolved at line 35; we capture it as the resource and stamp
        // the sender via `actor_member_id` (set automatically by the
        // ctx.audit helper). `subject` is staff-authored so it's safe
        // verbatim; the email body is intentionally NOT recorded
        // (could be PHI; the resend dashboard has it for a few days).
        void ctx.audit({
          action: 'email.send',
          resourceType: 'club_member',
          resourceId: recipient[0].id,
          changes: {
            subject: { from: null, to: data.subject },
          },
        });

        return successResponse({ id: result.id, message: 'Email sent' }, 201);
      } catch (err) {
        logger.error('email_send_error', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        return errorResponse('EMAIL_ERROR', 'Failed to send email', 500);
      }
    },
    {
      requiredPermission: 'emails:create',
      // Cap ad-hoc sends well below the default 60/min. Transactional email
      // flows (booking confirmation etc.) bypass this endpoint entirely.
      // failClosed (audit LOW 2026-05-06) — same rationale as the inline
      // recipient/club caps above; an Upstash outage must NOT lift the
      // limit on a verified-sender spam relay surface.
      rateLimit: { maxRequests: 20, windowMs: 60_000, failClosed: true },
      routeKey: 'emails:send',
    },
  );
}
