import { type NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { rawDb } from '@equestrian/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';
import { getClientIp } from '@/lib/request-ip';
import { logger } from '@/lib/logger';

/**
 * Public probe — Cloudflare's external health checks hit this
 * unauthenticated, so we cannot gate on Clerk. IP-keyed rate limit caps
 * abuse without breaking the legitimate probe.
 *
 * Two modes (audit H-4):
 *
 *   * **Default (liveness)** — answers 200 with `status: 'ok'` if the
 *     Worker is reachable. Used by the cheapest external monitor.
 *
 *   * **`?deep=1` (readiness)** — also runs a SELECT 1 against Neon
 *     (HTTP driver) and a PING against Upstash Redis. Returns 503 if
 *     any subsystem fails, with per-subsystem status. Used by the
 *     deeper monitor that should page when a dependency is down.
 *
 * Why split: cheap pollers run liveness; readiness is more expensive
 * (round-trips to Neon + Redis) and shouldn't be hit hundreds of times
 * a minute.
 */
export async function GET(request: NextRequest) {
  // Audit r5 F-46 (2026-05-07): IP resolver moved to `lib/request-ip.ts`.
  const ip = getClientIp(request);

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

  const deep = request.nextUrl.searchParams.get('deep') === '1';
  if (!deep) {
    return NextResponse.json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Deep readiness probe.
  const subsystems: Record<string, { ok: boolean; error?: string }> = {};

  // Neon Postgres
  try {
    await rawDb.execute(sql`SELECT 1`);
    subsystems.database = { ok: true };
  } catch (err) {
    subsystems.database = {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }

  // Upstash Redis (treated as ok when unconfigured — dev environments)
  const redis = getRedis();
  if (!redis) {
    subsystems.redis = { ok: true, error: 'not configured (skipped)' };
  } else {
    try {
      await redis.ping();
      subsystems.redis = { ok: true };
    } catch (err) {
      subsystems.redis = {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  const allOk = Object.values(subsystems).every((s) => s.ok);
  if (!allOk) {
    logger.error('health_deep_probe_failed', { subsystems });
  }

  return NextResponse.json(
    {
      success: allOk,
      data: {
        status: allOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        subsystems,
      },
    },
    { status: allOk ? 200 : 503 },
  );
}
