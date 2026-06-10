import { type NextRequest } from 'next/server';
import { getPublicClubBySlug } from '@equestrian/db/queries';
import { checkRateLimit } from '@/lib/rate-limit';
import { successResponse, errorResponse, rateLimitedResponse } from '@/lib/api-utils';
import { getClientIp } from '@/lib/request-ip';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  // Audit pass-5 LOW-8 (2026-05-21): the sibling list route uses
  // `getClientIp` for the same rate-limit key, but this slug route
  // inlined a hand-rolled header chain that drifts from the helper as
  // it evolves (canonical Workers header order, IPv6 zone-id, etc.).
  // Use the shared helper so both discover routes resolve the same
  // client identity for throttling.
  const ip = getClientIp(request);
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
    return rateLimitedResponse(rl, { message: 'Too many requests' });
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
