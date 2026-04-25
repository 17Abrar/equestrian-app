import { type NextRequest, NextResponse } from 'next/server';
import { getPublicClubBySlug } from '@equestrian/db/queries';
import { checkRateLimit } from '@/lib/rate-limit';

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
  const rl = await checkRateLimit(`discover:slug:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const { slug } = await params;
  const club = await getPublicClubBySlug(slug);
  if (!club) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Club not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, data: club });
}
