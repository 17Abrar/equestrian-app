import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { paginationSchema } from '@equestrian/shared/schemas';
import { listPublicClubs } from '@equestrian/db/queries';
import { errorResponse, paginatedResponse } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';

// Public endpoint — no auth required. Allows sign-out riders to browse clubs
// before committing to a sign-up. Rate-limited per source IP because there
// is no userId to key on, and unauthenticated discovery is the obvious
// scrape target.

// Audit F-22/F-23 (2026-05-06): `.strict()` rejects unknown keys; `.max(200)`
// caps user input on the unauthenticated discovery endpoint. The route is
// rate-limited (20 req/min per IP), but capped lengths reduce the amplifier.
//
// Audit pass-10 F-7 (2026-05-14): reuse the shared `paginationSchema`
// (capped at MAX_PAGE_SIZE = 50, default DEFAULT_PAGE_SIZE = 25) instead
// of a local `.max(100).default(20)`. The shared cap exists to keep
// join-heavy queries inside the Workers subrequest budget — letting the
// public discover endpoint exceed it was a silent divergence.
const queryShape = z
  .object({
    search: z.string().max(200).optional(),
    city: z.string().max(200).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  // Tight per-IP cap because this endpoint is unauthenticated and the obvious
  // scrape target — competitor crawls, phishing-list builders. failClosed so a
  // Redis blip doesn't downgrade us to per-isolate counters (which on Workers
  // is barely a throttle); a real user can retry, an attacker is bounced.
  const rl = await checkRateLimit(`discover:list:${ip}`, {
    maxRequests: 20,
    windowMs: 60_000,
    failClosed: true,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = queryShape.safeParse(sp);
  if (!parsed.success) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Invalid query parameters',
      400,
      parsed.error.flatten(),
    );
  }

  const { data, total } = await listPublicClubs(parsed.data);
  const { page, pageSize } = parsed.data;

  return paginatedResponse(data, { page, pageSize, total });
}
