import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentry-shared';

// Runs on every server-rendered request and inside API routes.
// Sentry.init is a no-op if SENTRY_DSN is unset, so it's safe to ship
// without a DSN in dev.

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // `sendDefaultPii` left at its default (false) — audit F-4 (2026-05-05).
  // The Sentry SDK would otherwise attach the request IP, full User-Agent,
  // and (on browser) cookies to every event. User attribution is preserved
  // via `scope.setUser({ id })` in `lib/logger.ts`, which only ships the
  // Clerk userId — no IP/UA/PII. If we later want truncated-IP for rate-
  // limit attribution, capture it explicitly into a tag rather than
  // re-enabling sendDefaultPii globally.
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
  // Audit H-8: scrub breadcrumbs at collection time — many integrations
  // attach query strings to `breadcrumb.message`, which the event-level
  // scrub historically missed.
  beforeBreadcrumb: scrubSentryBreadcrumb,
});
