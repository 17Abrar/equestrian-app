import { logger } from './logger';

/**
 * Audit F-14 (2026-05-06 r2). Boot-time check for env vars whose
 * absence in production silently degrades behavior:
 *
 *   - SENTRY_DSN — error reports stop reaching Sentry; logger falls
 *     through to console-only.
 *   - RESEND_API_KEY — every transactional email becomes a no-op.
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — rate limiter
 *     falls back to per-isolate in-memory counters; the failClosed
 *     gate doesn't trip without Redis available.
 *
 * Each check warns rather than throws so dev/staging environments
 * (which often run without these) still boot. The warn lands once at
 * startup — operators who notice it can fix the Wrangler secret
 * before it bites them at midnight.
 */
const PRODUCTION_REQUIRED_ENV_VARS: ReadonlyArray<{
  name: string;
  alsoCheck?: string;
  effect: string;
}> = [
  {
    name: 'SENTRY_DSN',
    alsoCheck: 'NEXT_PUBLIC_SENTRY_DSN',
    effect: 'error reports will not reach Sentry; logger.error → console-only',
  },
  {
    name: 'RESEND_API_KEY',
    effect: 'every transactional email is a no-op (registration, payment, reminder)',
  },
  {
    name: 'UPSTASH_REDIS_REST_URL',
    alsoCheck: 'UPSTASH_REDIS_REST_TOKEN',
    effect: 'rate limiter falls back to per-isolate in-memory; failClosed gate is degraded',
  },
  // Audit F-26 (2026-05-07 r4): without EMAIL_FROM the resolveFromAddress
  // helper returns null and refuses to send. Without this boot warn the
  // operator only sees the failure on first send (hours after a bad deploy).
  {
    name: 'EMAIL_FROM',
    effect: 'transactional emails are no-ops; no booking confirmations, invoices, resets',
  },
];

export function assertProductionEnvConfigured(): void {
  const missing: string[] = [];
  for (const { name, alsoCheck, effect } of PRODUCTION_REQUIRED_ENV_VARS) {
    const primary = process.env[name];
    const fallback = alsoCheck ? process.env[alsoCheck] : undefined;
    if (!primary && !fallback) {
      missing.push(`${name}${alsoCheck ? ` (or ${alsoCheck})` : ''} — ${effect}`);
    }
  }
  if (missing.length > 0) {
    logger.warn('env_misconfigured', {
      missing,
      note: 'Production env vars missing — features degrade silently. Verify Wrangler secrets.',
    });
  }
}
