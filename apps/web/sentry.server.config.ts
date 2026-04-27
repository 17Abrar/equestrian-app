import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './lib/sentry-shared';

// Runs on every server-rendered request and inside API routes.
// Sentry.init is a no-op if SENTRY_DSN is unset, so it's safe to ship
// without a DSN in dev.

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  // 10% prod sampling keeps ingest cost bounded; 100% in dev for full signal.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  includeLocalVariables: true,
  enableLogs: true,
  enabled: !!process.env.SENTRY_DSN,

  // Strip credentials from headers AND from URLs/breadcrumbs. `sendDefaultPii:
  // true` would otherwise capture the Stripe OAuth `?code=…&state=…` callback
  // verbatim (a long-lived authorization code stored in our error vendor),
  // plus Clerk `__session` cookies on the URL of any 500 hit during sign-in.
  // Shared with the edge config so middleware-thrown 500s scrub identically.
  beforeSend: scrubSentryEvent,
});
