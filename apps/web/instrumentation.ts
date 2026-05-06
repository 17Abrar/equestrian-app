import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }

  // Audit LOW (2026-05-06 closeout): validate ENCRYPTION_KEY at app
  // boot rather than lazily on first encrypt. Without this, a deploy
  // that forgot to set the secret (or set the all-zeros placeholder
  // in prod) passes health checks and read-side smoke flows, then
  // crashes the FIRST insert that touches an encrypted column (vet
  // log, payment-account connect). The throw here surfaces during
  // the deploy gate's startup probe instead of at midnight when an
  // admin first writes a medication record. Sub-millisecond cost.
  //
  // Only fires in the Node runtime where encryption actually runs.
  // The build step (`scripts/collect-page-data.mjs`) doesn't pass
  // through `register()` so a missing key during build doesn't crash
  // the build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertEncryptionKeyConfigured } = await import('@equestrian/db/crypto');
    assertEncryptionKeyConfigured();

    // Audit F-14 (2026-05-06 r2): warn-level startup check for env
    // vars whose absence degrades behavior silently (Sentry stops
    // reporting, Resend silently no-ops, Upstash falls back to in-
    // process). Doesn't throw — degrades cleanly in dev/staging — but
    // surfaces a single structured warn at boot so a typo'd Wrangler
    // secret in prod is visible the moment the Worker starts.
    if (process.env.NODE_ENV === 'production') {
      const { assertProductionEnvConfigured } = await import('./lib/env-check');
      assertProductionEnvConfigured();
    }
  }
}

// Forward all request-scoped errors to Sentry so the unhandled-error branch
// in api-utils still gets captured.
//
// Wrapped in try/catch because `Sentry.captureRequestError` on
// `@opennextjs/cloudflare` can throw an AsyncLocalStorage error that bubbles
// up and 500s the request. Swallowing here preserves availability; worst
// case is a dropped error report.
// See https://github.com/getsentry/sentry-javascript/issues/18842
//
// `captureRequestError` returns synchronously despite having an async
// signature — wrapping it as `(...args) => { try {...} catch }` keeps the
// type compatibility while letting lint reason about the void-return
// shape correctly.
export const onRequestError: typeof Sentry.captureRequestError = (
  err,
  request,
  context,
) => {
  try {
    Sentry.captureRequestError(err, request, context);
  } catch (sentryErr) {
    // Don't re-throw — masking the original error is worse than dropping the
    // report. But log via raw console so the failure surfaces in Cloudflare
    // logs even when Sentry itself is the broken subsystem (the app-side
    // logger forwards to Sentry, so it would loop).
    // eslint-disable-next-line no-console
    console.error('[sentry] captureRequestError failed:', sentryErr);
  }
};
