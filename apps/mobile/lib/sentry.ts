import * as Sentry from '@sentry/react-native';

/**
 * Audit F-49 (2026-05-08 r6): Sentry wiring for mobile.
 *
 * Web has had `@sentry/nextjs` since launch (`apps/web/lib/logger.ts`
 * forwards every `logger.error` / `logger.warn` to Sentry); mobile
 * was relying on `console.error` to Metro/device console only.
 * Production token-cache regressions and api-error patterns
 * therefore couldn't page anyone — this file closes that gap.
 *
 * Init is gated on `EXPO_PUBLIC_SENTRY_DSN`. When absent (local dev,
 * staging without ops yet), `init()` is a no-op and the
 * `captureException` helpers below short-circuit so Metro logs
 * stay clean.
 *
 * Mounted at the root layout (`apps/mobile/app/_layout.tsx`)
 * BEFORE any other imports so the SDK can hook the global error
 * handler and unhandled-promise-rejection paths. Subsequent imports
 * (Clerk, query-client, screens) are auto-instrumented for navigation
 * + fetch when `enableAutoSessionTracking` and `_experiments` are
 * configured.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  if (!dsn) {
    // No DSN configured — Sentry stays inert. The `captureException`
    // helper below short-circuits so callers don't pay any cost.
    return;
  }

  Sentry.init({
    dsn,
    // Trim the data Sentry collects to what's useful in production.
    // No PII / breadcrumbs from `console.log` (those routinely carry
    // request bodies and tokens during dev iteration).
    enableNative: true,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    debug: process.env.EXPO_PUBLIC_SENTRY_DEBUG === 'true',
    // 10% trace sampling — same posture as web.
    tracesSampleRate: 0.1,
  });
}

/**
 * Capture an exception with structured context. Mirrors the web-
 * side `logger.error(event, { ...context })` shape so Sentry tag
 * conventions are consistent across both clients.
 */
export function captureMobileException(
  error: unknown,
  event: string,
  context?: Record<string, unknown>,
): void {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTag('logger.event', event);
    if (context) scope.setContext('event_data', context);
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureException(new Error(typeof error === 'string' ? error : event));
    }
  });
}
