import { logger } from '@/lib/logger';
import { PaymentProviderError } from './types';

/**
 * Type guard that accepts both `PaymentProviderError` and any provider
 * error class that mirrors its `code` + `retryable` shape (e.g.
 * `PlatformZiinaError` in `apps/web/lib/billing/platform-ziina.ts`,
 * which is parallel-tree to PaymentProviderError because the platform
 * Ziina path is single-merchant). The audit's contract is
 * "retry only when retryable === true"; this guard preserves that
 * across both error families without requiring them to share a base
 * class.
 */
function isRetryableProviderError(
  err: unknown,
): err is { code: string; retryable: boolean; message: string } {
  if (err instanceof PaymentProviderError) return err.retryable;
  if (
    err !== null &&
    typeof err === 'object' &&
    'retryable' in err &&
    typeof (err as { retryable: unknown }).retryable === 'boolean'
  ) {
    return (err as { retryable: boolean }).retryable;
  }
  return false;
}

/**
 * Audit F-23 (2026-05-07 r5): bounded retry loop for provider adapter
 * calls. Pre-fix, every adapter set `retryable: true` on its
 * `PaymentProviderError` for transient 5xx / 429 / network errors, but
 * the only thing the route layer did with the flag was map it to HTTP
 * 503 vs 502 in the response. No in-process retry — a Stripe / Ziina /
 * N-Genius blip during a payment-init call surfaced as a hard 503
 * straight to the rider.
 *
 * Mirrors `apps/web/lib/email.ts:113-144` `sendWithRetry`. Idempotency
 * keys for our payment calls are stable (`booking_${booking.id}`,
 * `livery:${horseId}:${period}`), so retries against Stripe / Ziina
 * return the original intent rather than minting a duplicate. The
 * total wallclock is ~2.2s — safe inside Cloudflare Workers' wall-time
 * budget for the route handler.
 *
 * Only retries when `err instanceof PaymentProviderError && err.retryable
 * === true`. DB write errors (`DrizzleError`, connection errors), as
 * well as `PaymentProviderError` with `retryable: false` (auth failures,
 * invalid credentials, validation), pass through without a retry — those
 * won't fix themselves on attempt 2.
 */
const DEFAULT_BACKOFFS_MS: ReadonlyArray<number> = [500, 1500];

export interface ProviderRetryOptions {
  /**
   * Maximum number of attempts including the first. Defaults to
   * `backoffMs.length + 1` (i.e. one attempt per delay slot, plus the
   * initial attempt).
   */
  maxAttempts?: number;
  /** Backoff delays between attempts. Defaults to [500, 1500]. */
  backoffMs?: ReadonlyArray<number>;
  /**
   * Operator-readable label for the call site (e.g.
   * 'booking_payment_init', 'platform_pay_link_refresh'). Logged with
   * each retry attempt so a grep against `provider_call_retry`
   * surfaces which surface is flapping.
   */
  label: string;
  /** Optional structured-log fields appended to retry / exhaustion logs. */
  context?: Record<string, unknown>;
}

export async function withProviderRetry<T>(
  fn: () => Promise<T>,
  options: ProviderRetryOptions,
): Promise<T> {
  const backoffs = options.backoffMs ?? DEFAULT_BACKOFFS_MS;
  const maxAttempts = options.maxAttempts ?? backoffs.length + 1;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = isRetryableProviderError(err);
      if (!isRetryable || attempt >= maxAttempts) {
        // Either non-retryable (auth failure, validation, or a
        // non-provider error like DrizzleError) or out of attempts.
        // Re-throw so the caller's existing catch branch handles it
        // (route maps to 502/503/422).
        throw err;
      }
      const delay = backoffs[attempt - 1] ?? backoffs[backoffs.length - 1] ?? 1000;
      logger.warn('provider_call_retry', {
        ...options.context,
        label: options.label,
        attempt,
        nextDelayMs: delay,
        code:
          err instanceof PaymentProviderError
            ? err.code
            : err && typeof err === 'object' && 'code' in err
              ? String((err as { code: unknown }).code)
              : 'unknown',
        message: err instanceof Error ? err.message : 'unknown',
      });
      // Jitter so concurrent failing callers don't all retry in lockstep.
      const jittered = delay + Math.floor(Math.random() * 250);
      await new Promise<void>((resolve) => setTimeout(resolve, jittered));
    }
  }
  // Unreachable — the loop either returns or rethrows. TypeScript needs
  // an explicit throw to satisfy the return type.
  throw lastErr;
}
