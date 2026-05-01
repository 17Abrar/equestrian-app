import { type NextRequest, NextResponse } from 'next/server';
import { getPublicClubBySlug } from '@equestrian/db/queries';
import { checkRateLimit } from '@/lib/rate-limit';
import { successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  // Slug-detail returns 404 vs 200 in measurable time — this route is the
  // obvious target for slug enumeration. Throttle per source IP.
  // Audit D-1: failClosed so a Redis outage doesn't drop the throttle
  // entirely — the sibling list endpoint already does.
  const rl = await checkRateLimit(`discover:slug:${ip}`, {
    maxRequests: 60,
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

  // Audit L-2-frontend / F-37: defensive bounds on the slug path segment.
  // Drizzle's parameterised queries are injection-safe but the DB still
  // pays the cost of looking up a 1KB nonsense slug. Cheap pre-check.
  const { slug } = await params;
  if (slug.length > 100 || !/^[a-z0-9-]+$/.test(slug)) {
    return errorResponse('NOT_FOUND', 'Club not found', 404);
  }

  const club = await getPublicClubBySlug(slug);
  if (!club) {
    return errorResponse('NOT_FOUND', 'Club not found', 404);
  }
  // Audit D-2: route through the success-response helper so future
  // changes (e.g. adding `x-request-id`) propagate uniformly.
  return successResponse(club);
}
