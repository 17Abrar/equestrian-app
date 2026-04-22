import * as Sentry from '@sentry/nextjs';

// Runs inside the edge runtime — currently just the Clerk middleware.
// Edge has no Node APIs, so we keep this init minimal.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
  enabled: !!process.env.SENTRY_DSN,
});
