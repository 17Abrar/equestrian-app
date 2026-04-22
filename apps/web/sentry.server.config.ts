import * as Sentry from '@sentry/nextjs';

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

  // Drop headers that sometimes carry secrets (Authorization, cookies) so
  // `sendDefaultPii: true` doesn't leak them on server-captured events.
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }
    return event;
  },
});
