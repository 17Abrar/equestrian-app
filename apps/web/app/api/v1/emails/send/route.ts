import { Resend } from 'resend';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

// Plain-text only — no `html` field. A compromised staff account can
// already use this endpoint to spam every member of their club, but
// accepting raw HTML would let them mount more convincing phishing
// templates served from the club's verified Resend domain. If we ever
// need rich content, add a server-side allowlist (DOMPurify) — never
// pass through caller-supplied HTML.
const sendEmailSchema = z.object({
  to: z.string().email('Invalid email address'),
  subject: z.string().min(1, 'Subject is required').max(500),
  body: z.string().min(1, 'Body is required').max(20_000),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const reqBody = await request.json();
      const data = validateInput(sendEmailSchema, reqBody);

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

      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        return errorResponse('EMAIL_NOT_CONFIGURED', 'Email service is not configured. Set RESEND_API_KEY.', 503);
      }

      const resend = new Resend(resendApiKey);
      const fromAddress = process.env.EMAIL_FROM ?? 'Cavaliq <onboarding@resend.dev>';

      try {
        const { data: result, error } = await resend.emails.send({
          from: fromAddress,
          to: [data.to],
          subject: data.subject,
          text: data.body,
        });

        if (error) {
          logger.error('email_send_failed', {
            clubId: ctx.clubId,
            to: data.to,
            subject: data.subject,
            error: error.message,
          });
          return errorResponse('EMAIL_FAILED', 'Failed to send email', 500);
        }

        logger.info('email_sent', {
          clubId: ctx.clubId,
          to: data.to,
          subject: data.subject,
          resendId: result?.id,
        });

        return successResponse({ id: result?.id, message: 'Email sent' }, 201);
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
      rateLimit: { maxRequests: 20, windowMs: 60_000 },
      routeKey: 'emails:send',
    },
  );
}
