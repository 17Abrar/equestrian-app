import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
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
export const onRequestError: typeof Sentry.captureRequestError = async (
  err,
  request,
  context,
) => {
  try {
    return await Sentry.captureRequestError(err, request, context);
  } catch (sentryErr) {
    // Don't re-throw — masking the original error is worse than dropping the
    // report. But log via raw console so the failure surfaces in Cloudflare
    // logs even when Sentry itself is the broken subsystem (the app-side
    // logger forwards to Sentry, so it would loop).
    // eslint-disable-next-line no-console
    console.error('[sentry] captureRequestError failed:', sentryErr);
  }
};
