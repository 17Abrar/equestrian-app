import * as Sentry from '@sentry/nextjs';

// Next 15+ canonical client instrumentation. Loads automatically in the
// browser bundle. The old `sentry.client.config.ts` filename is deprecated.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  integrations: [
    Sentry.replayIntegration(),
  ],
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Scrub sensitive OAuth query params from the captured URL before the
  // event leaves the browser.
  beforeSend(event) {
    if (event.request?.url) {
      try {
        const url = new URL(event.request.url);
        ['code', 'state', 'token', 'access_token', 'refresh_token'].forEach((key) =>
          url.searchParams.delete(key),
        );
        event.request.url = url.toString();
      } catch {
        // Non-URL strings pass through untouched.
      }
    }
    return event;
  },
});

// Emits a Sentry transaction for every client-side router navigation so we
// get waterfall traces across page transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
