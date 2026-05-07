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
  // Audit F-60 (2026-05-07 r4 Xi-bis): without CRON_SECRET every cron
  // endpoint 503s on `${eventName}_secret_not_configured`. Worker-entry's
  // F-43 self-check probe surfaces this loudly per cold start, but the
  // boot warn lands once at startup and gives the operator a single
  // entry point to grep on regardless of cron schedule cadence.
  {
    name: 'CRON_SECRET',
    effect: 'every cron endpoint 503s; livery / platform / booking / horse-care reminders all silently skip',
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

  // Audit F-10 (2026-05-07 r5): PLATFORM_ZIINA_TEST_MODE drives the
  // Ziina sandbox `test` flag. It MUST be unset (or `false`) in
  // production — `true` means platform-billing payment intents would
  // hit Ziina sandbox and never settle. A staging template that leaks
  // into prod (e.g. via copy-paste of a wrangler env block) is the
  // exact failure mode this warn catches at boot.
  if (process.env.PLATFORM_ZIINA_TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
    logger.warn('env_misconfigured', {
      missing: [
        'PLATFORM_ZIINA_TEST_MODE === "true" in production — platform-billing payment intents will hit Ziina sandbox and never settle. Unset this var (staging-only).',
      ],
      note: 'PLATFORM_ZIINA_TEST_MODE is staging-only. See ENV.md and DEPLOY.md.',
    });
  }
}
