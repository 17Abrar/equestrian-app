import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { sendOperationalEmailAsync } from '@/lib/email-support';
import { logger } from '@/lib/logger';

/**
 * Captures interest signals for the Community feature while it's pre-launch.
 * Closes audit P0-C (2026-05-26): the three "Coming soon" Community
 * surfaces are no longer purely decorative — they now offer an actionable
 * "Notify me when this ships" affordance that this endpoint backs.
 *
 * Public, unauthenticated — riders and visiting prospects can both submit.
 * The signal goes to the operational inbox; no DB table is created
 * because (a) volume is low pre-launch, (b) the email itself is the
 * single source of truth that's easy to act on, and (c) avoiding a new
 * table avoids a migration on the close-out path.
 */
const NOTIFY_INBOX = 'info@cavaliq.com';

const SOURCES = ['web_admin', 'web_rider', 'mobile'] as const;

const notifyMeSchema = z
  .object({
    email: z.string().trim().email().max(254),
    source: z.enum(SOURCES),
  })
  .strict();

export async function POST(request: NextRequest) {
  // CSRF: require an exact `application/json` media type. Without this,
  // a cross-origin `fetch` from a hostile site with `Content-Type:
  // text/plain` (or `text/plain; note=application/json` to bypass a
  // substring check) is a CORS-safelisted "simple request" — no
  // preflight fires and `request.json()` would still parse the body.
  // Requiring exact `application/json` forces the browser to preflight,
  // which the CORS allowlist in middleware.ts blocks for non-approved
  // origins. Parse the media type out of the full header so legitimate
  // `application/json; charset=utf-8` still passes. Caught by codex
  // review on this PR's first and second passes.
  const mediaType = (request.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return errorResponse(
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json',
      415,
    );
  }

  const ip = getClientIp(request);

  // Tight cap because the endpoint is unauthenticated and would otherwise
  // be a free email-relay surface. failClosed mirrors the support-contact
  // route — better to refuse during an Upstash blip than fall back to
  // per-isolate counters that barely throttle on Workers.
  const rl = await checkRateLimit(`community:notify:${ip}`, {
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

  const parsed = notifyMeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Please check your email and try again',
      400,
      parsed.error.flatten(),
    );
  }

  const { email, source } = parsed.data;

  const text = [
    `New community waitlist signup`,
    '',
    `Email: ${email}`,
    `Source: ${source}`,
    `IP: ${ip}`,
    `User-Agent: ${request.headers.get('user-agent') ?? 'unknown'}`,
    '',
    'When community ships, broadcast to all signups via the Emails Broadcast feature.',
  ].join('\n');

  sendOperationalEmailAsync({
    to: NOTIFY_INBOX,
    subject: `[Cavaliq Community] Waitlist signup — ${source}`,
    text,
    replyTo: email,
  });

  logger.info('community_notify_me_signup', {
    source,
    email,
    ip,
  });

  return successResponse({ received: true });
}
