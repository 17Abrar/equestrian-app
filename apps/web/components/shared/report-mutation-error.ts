import * as Sentry from '@sentry/nextjs';

/**
 * Reports a client-side mutation failure to Sentry, tagged with the mutation
 * key so support can filter by feature ("feeding.delete failures jumped at
 * 14:00 UTC").
 *
 * Wrap your `catch` block with this — the user-facing toast is yours to
 * compose, but the error MUST flow somewhere. A bare `catch { toast.error(...) }`
 * means a 500 from the backend is invisible to ops: the user sees "try again",
 * shrugs, and the regression sits unfixed.
 *
 * Falls back to console.error if Sentry isn't configured (dev / preview).
 */
export function reportMutationError(
  mutationKey: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const errorInstance =
    error instanceof Error ? error : new Error(String(error ?? 'unknown'));

  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setTag('mutation_key', mutationKey);
    if (extra) scope.setContext('mutation_extra', extra);
    Sentry.captureException(errorInstance);
  });

  // Surface in the browser console too — Sentry's web UI lags by ~30s and
  // local-dev sessions usually don't have a DSN configured at all.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[mutation:${mutationKey}]`, errorInstance, extra);
  }
}
