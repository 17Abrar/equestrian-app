import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentry-shared';

// Next 15+ canonical client instrumentation. Loads automatically in the
// browser bundle. The old `sentry.client.config.ts` filename is deprecated.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: true,
  // Trace 10% of requests in prod — lower would be quieter but loses coverage
  // of slow requests. Tweak if sampling volume gets expensive.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Session replay disabled in prod: it was adding ~40 KB of client JS plus
  // continuous DOM recording overhead on every page. Replay still fires on
  // thrown errors via `replaysOnErrorSampleRate` so crash reports keep their
  // video context.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  // Mask all text + form inputs and block media so a replay of a guest-
  // booking form doesn't capture the rider's name, phone number, or
  // child's details. networkDetailAllowUrls left empty so we don't store
  // request bodies (PII risk). See audit H-7 / H-20.
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      networkDetailAllowUrls: [],
      networkRequestHeaders: [],
      networkResponseHeaders: [],
    }),
  ],
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Scrub credentials from headers, query strings, AND breadcrumb URLs.
  // The previous inline scrubber only stripped 5 query keys and ignored
  // headers entirely — Clerk's __session cookie + bearer tokens leaked
  // into Sentry context (audit H-7). The shared scrubber is runtime-
  // portable (URL/URLSearchParams only) so it runs the same on server,
  // edge, and browser.
  beforeSend: scrubSentryEvent,
  // Audit H-8: scrub breadcrumbs at collection time. Sentry's fetch
  // integration attaches request URLs to `breadcrumb.message` on the
  // browser; without this hook the URL's query params land verbatim
  // in the captured event.
  beforeBreadcrumb: scrubSentryBreadcrumb,
});

// Emits a Sentry transaction for every client-side router navigation so we
// get waterfall traces across page transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
