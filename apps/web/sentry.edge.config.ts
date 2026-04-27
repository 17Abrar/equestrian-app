import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './lib/sentry-shared';

// Runs inside the edge runtime — currently just the Clerk middleware.
// Edge has no Node APIs, so we keep this init minimal. The scrubber uses
// only URL/URLSearchParams so it works under both runtimes.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
  enabled: !!process.env.SENTRY_DSN,

  // Edge runtime is what handles middleware.ts. A 500 thrown there during a
  // Stripe OAuth bounce would otherwise capture the `?code=…&state=…`
  // callback URL verbatim — same risk as the server config, same fix.
  beforeSend: scrubSentryEvent,
});
