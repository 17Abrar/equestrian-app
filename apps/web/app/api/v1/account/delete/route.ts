import { type NextRequest } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { z } from 'zod';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendOperationalEmailAsync } from '@/lib/email-support';
import { logger } from '@/lib/logger';

const PRIVACY_INBOX = 'info@cavaliq.com';

const deleteSchema = z
  .object({
    confirm: z.literal('DELETE'),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();

/**
 * Account deletion request endpoint.
 *
 * App Store guideline 5.1.1(v) and Google Play both require an in-app
 * mechanism for a user to delete their account. This route does NOT
 * synchronously wipe the user's data — equestrian SaaS has cascading
 * dependencies (bookings, attached rider profiles, horse ownership records)
 * that need a human to disentangle within the 30-day window committed in
 * the privacy policy. The endpoint:
 *
 *   1. Verifies the Clerk session.
 *   2. Logs the deletion intent.
 *   3. Emails info@cavaliq.com with the user details so ops can complete
 *      the deletion or coordinate with the user's club.
 *   4. Sends the user a confirmation email.
 *   5. Returns success so the client can sign out and show a confirmation
 *      screen.
 *
 * Rate-limited per-user (3 / 24h) so a hijacked session can't spam the
 * privacy inbox.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
    }

    const rl = await checkRateLimit(`account:delete:${userId}`, {
      maxRequests: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
      return errorResponse(
        'RATE_LIMITED',
        'You have already submitted a deletion request recently. Check your email.',
        429,
        { retryAfter },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Body must be valid JSON', 400);
    }
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'VALIDATION_ERROR',
        "Type DELETE to confirm. Field 'confirm' must equal 'DELETE'.",
        400,
        parsed.error.flatten(),
      );
    }

    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    const fullName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || '(no name on file)';
    const ip = getClientIp(request);

    logger.info('account_deletion_requested', {
      userId,
      email,
      ip,
      hasReason: Boolean(parsed.data.reason),
    });

    const opsBody = [
      'Account deletion request received via the mobile app or web.',
      '',
      `User ID (Clerk): ${userId}`,
      `Name: ${fullName}`,
      `Email: ${email ?? 'unknown'}`,
      `IP: ${ip}`,
      `Submitted at: ${new Date().toISOString()}`,
      '',
      parsed.data.reason ? `User reason:\n${parsed.data.reason}` : 'No reason provided.',
      '',
      'Action required:',
      '  1. Identify all club_members rows for this Clerk ID.',
      '  2. For each club, coordinate with the admin to decide what to do',
      '     with attached rider profiles, bookings, and ownership records.',
      '  3. Complete deletion within 30 days per the privacy policy, or earlier.',
      '  4. Reply to the user at the email above with the outcome.',
    ].join('\n');

    sendOperationalEmailAsync({
      to: PRIVACY_INBOX,
      subject: `[Cavaliq] Account deletion request — ${fullName}`,
      text: opsBody,
      ...(email ? { replyTo: email } : {}),
    });

    if (email) {
      const userBody = [
        `Hi ${user?.firstName ?? 'there'},`,
        '',
        "We've received your request to delete your Cavaliq account.",
        '',
        "We'll complete deletion within 30 days, as set out in our privacy",
        'policy at https://cavaliq.com/legal/privacy. Some records (e.g. payment',
        'invoices) may be retained for the period required by tax law, in line',
        'with our retention schedule.',
        '',
        "If you didn't request this, reply to this email immediately and we'll",
        'cancel the request.',
        '',
        'Thank you for using Cavaliq.',
        '',
        '— The Cavaliq team',
      ].join('\n');

      sendOperationalEmailAsync({
        to: email,
        subject: 'Your Cavaliq account deletion request',
        text: userBody,
      });
    }

    return successResponse({ requested: true });
  } catch (error) {
    logger.error('account_deletion_failed', {
      error: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
