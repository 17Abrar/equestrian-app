import { type NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { rawDb } from '@equestrian/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';
import { getClientIp } from '@/lib/request-ip';
import { logger } from '@/lib/logger';

/**
 * Audit pass-5 LOW-7 (2026-05-21): scrub host/DSN shapes out of a
 * subsystem-probe error before logging. Driver errors at the network
 * layer (Postgres / Redis / R2) commonly embed the hostname or the
 * full connection string in the message — e.g. `getaddrinfo ENOTFOUND
 * ep-xyz-east-1.aws.neon.tech` or `postgres://user:pass@host/db`.
 * That's configuration/targeting metadata operators don't need to see
 * in the structured log (Sentry's exception capture, for whoever is
 * on call). Classify generically and truncate.
 *
 * Returns one of: `'connection_failed'`, `'auth_failed'`, `'timeout'`,
 * `'unknown'`, plus a generic-only first 80 chars of the message with
 * URI authorities and bare hostnames blanked out.
 */
function sanitizeProbeError(raw: string | undefined): { class: string; preview: string } {
  if (!raw) return { class: 'unknown', preview: '' };
  const lower = raw.toLowerCase();
  let cls = 'unknown';
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('network') ||
    lower.includes('connect ')
  ) {
    cls = 'connection_failed';
  } else if (
    lower.includes('authentication') ||
    lower.includes('password') ||
    lower.includes('401') ||
    lower.includes('unauthorized')
  ) {
    cls = 'auth_failed';
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    cls = 'timeout';
  }
  const preview = raw
    // Strip URI authorities: `scheme://user:pass@host[:port]/...` → `scheme://[REDACTED]/...`
    .replace(/([a-z]+:\/\/)[^\s/]+/gi, '$1[REDACTED]')
    // Strip ENOTFOUND <hostname>, ECONNREFUSED <hostname:port>
    .replace(/(ENOTFOUND|ECONNREFUSED|ECONNRESET)\s+\S+/g, '$1 [HOST]')
    // Strip standalone hostnames that look like DNS names (3+ dotted labels)
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+){2,}\b/gi, '[HOST]')
    .slice(0, 80);
  return { class: cls, preview };
}

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

  const deep = request.nextUrl.searchParams.get('deep') === '1';

  // Audit F-23 (2026-05-08 r6): split limiter buckets — cheap liveness
  // stays at 120/min, deep probe drops to 30/min and goes failClosed
  // so an Upstash outage can't lift the cap on the Postgres-touching
  // path. The deep probe shares the Neon connection pool with every
  // authenticated route; without failClosed, a 1000 RPS attack from
  // one IP under an Upstash outage would burn the pool and degrade
  // all tenant traffic. Liveness stays open-fail because the
  // alternative (Upstash outage = liveness 503) would falsely page
  // every external monitor.
  const rl = deep
    ? await checkRateLimit(`health:deep:${ip}`, {
        maxRequests: 30,
        windowMs: 60_000,
        failClosed: true,
      })
    : await checkRateLimit(`health:${ip}`, {
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
  //
  // Audit 2026-05-13 (P1): the public response intentionally omits the
  // raw `err.message` for each subsystem. Returning it to anonymous
  // callers leaked infra topology — a Neon outage would surface
  // `getaddrinfo ENOTFOUND ...neon.tech`, exposing the provider, and a
  // Postgres-level error string could include schema/table names. The
  // full error (with stack) is now emitted ONLY to the structured
  // logger; the public payload reports `{ok: false}` per subsystem with
  // no diagnostic detail. Operators reading Sentry see the actionable
  // message; attackers probing the endpoint see nothing they can use
  // to fingerprint the stack.
  type SubsystemResult = { ok: boolean };
  const subsystems: Record<string, SubsystemResult> = {};
  const subsystemErrors: Record<string, string> = {};

  // Neon Postgres
  try {
    await rawDb.execute(sql`SELECT 1`);
    subsystems.database = { ok: true };
  } catch (err) {
    subsystems.database = { ok: false };
    subsystemErrors.database = err instanceof Error ? err.message : 'unknown';
  }

  // Upstash Redis (treated as ok when unconfigured — dev environments)
  const redis = getRedis();
  if (!redis) {
    subsystems.redis = { ok: true };
  } else {
    try {
      await redis.ping();
      subsystems.redis = { ok: true };
    } catch (err) {
      subsystems.redis = { ok: false };
      subsystemErrors.redis = err instanceof Error ? err.message : 'unknown';
    }
  }

  const allOk = Object.values(subsystems).every((s) => s.ok);
  if (!allOk) {
    // Audit pass-5 LOW-7 (2026-05-21): the public response sanitizes
    // subsystem failures down to `{ok:false}` but the log used to
    // include the full raw error message, which on Postgres/Redis
    // connection failures contains the host and sometimes the DSN-
    // shaped connection string (e.g. `getaddrinfo ENOTFOUND
    // ep-xyz-east-1.aws.neon.tech` or `postgres://user:pass@host/db`).
    // Operators on call only need to know WHICH subsystem failed and
    // a rough class of failure; the host/DSN is configuration metadata
    // an attacker who reads logs could use to target the database
    // host directly. Strip URI authorities + `ENOTFOUND <host>` shapes
    // before logging, and truncate.
    logger.error('health_deep_probe_failed', {
      subsystems: Object.fromEntries(
        Object.entries(subsystems).map(([k, v]) => [
          k,
          { ok: v.ok, error: v.ok ? undefined : sanitizeProbeError(subsystemErrors[k]) },
        ]),
      ),
    });
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
