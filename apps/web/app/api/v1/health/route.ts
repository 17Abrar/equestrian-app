import { type NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

// Public liveness probe — Cloudflare's external health checks hit this
// unauthenticated, so we cannot gate on Clerk. IP-keyed rate limit caps
// abuse without breaking the legitimate probe (which fires once every
// few seconds at most).
export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const rl = await checkRateLimit(`health:${ip}`, {
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.retryAfterMs ?? 1000) / 1000);
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
}
