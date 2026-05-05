import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentry-shared';

// Runs inside the edge runtime — currently just the Clerk middleware.
// Edge has no Node APIs, so we keep this init minimal. The scrubber uses
// only URL/URLSearchParams so it works under both runtimes.
//
// Audit Sentry-shared 1: prefer NEXT_PUBLIC_SENTRY_DSN as a fallback so
// the edge runtime can capture even when only the public DSN is plumbed
// to the OpenNext-built bundle.
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  // `sendDefaultPii` left at default (false) — see sentry.server.config.ts
  // (audit F-4 2026-05-05). Edge runtime sees mostly the Clerk middleware
  // path, which we explicitly do NOT want to capture IP/cookies on.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
  enabled: !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Edge runtime is what handles middleware.ts. A 500 thrown there during a
  // Stripe OAuth bounce would otherwise capture the `?code=…&state=…`
  // callback URL verbatim — same risk as the server config, same fix.
  beforeSend: scrubSentryEvent,
  // Audit H-8: scrub breadcrumb messages so a fetch breadcrumb logging
  // `GET /api/v1/payments/stripe/callback?code=ac_xxx&state=…` doesn't
  // ship the auth code to the error vendor.
  beforeBreadcrumb: scrubSentryBreadcrumb,
});
