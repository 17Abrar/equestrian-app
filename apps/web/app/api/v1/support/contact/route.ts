import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendOperationalEmailAsync } from '@/lib/email-support';
import { logger } from '@/lib/logger';

// Public, unauthenticated. Anyone visiting /support can send a message.
// Everything is routed to a single info@cavaliq.com inbox; the category
// from the form is included in the subject line so an internal triage
// rule can fan it out further if/when we split inboxes later.
const SUPPORT_INBOX = 'info@cavaliq.com';

const supportSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    category: z.enum([
      'general',
      'account',
      'booking',
      'privacy',
      'security',
      'feedback',
      'other',
    ]),
    message: z.string().trim().min(20).max(4000),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Tight cap because the endpoint is unauthenticated and would otherwise be a
  // free email-relay surface. failClosed so an Upstash blip doesn't downgrade
  // to per-isolate counters (which barely throttle on Workers).
  const rl = await checkRateLimit(`support:contact:${ip}`, {
    maxRequests: 5,
    windowMs: 60_000 * 10,
    failClosed: true,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be valid JSON', 400);
  }

  const parsed = supportSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Please check the form fields and try again',
      400,
      parsed.error.flatten(),
    );
  }

  const { name, email, category, message } = parsed.data;

  // Plain text is enough — no marketing styling, low risk of being flagged
  // as spam by Resend's reputation system. Reply-To is set so the support
  // team can reply directly from their mail client.
  const text = [
    `New support message from ${name} <${email}>`,
    '',
    `Category: ${category}`,
    `IP: ${ip}`,
    `User-Agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    '',
    '--- Message ---',
    message,
    '---',
    '',
    'Reply directly to this email to respond to the sender.',
  ].join('\n');

  sendOperationalEmailAsync({
    to: SUPPORT_INBOX,
    subject: `[Cavaliq Support] [${category}] ${name}`,
    text,
    replyTo: email,
  });

  // Best-effort audit so an operator can correlate a customer report with
  // the email that arrived in the inbox.
  logger.info('support_contact_received', {
    category,
    email,
    ip,
  });

  return successResponse({ received: true });
}
