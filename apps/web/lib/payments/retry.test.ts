import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withProviderRetry } from './retry';
import { PaymentProviderError } from './types';

/**
 * Audit 2026-05-13 (P1): unit tests for the bounded retry helper that
 * wraps every provider adapter call (Stripe / Ziina / N-Genius). The
 * helper retries ONLY on retryable PaymentProviderError, with backoff +
 * jitter, capped at maxAttempts. A regression here would either crash
 * the rider on transient 5xx / 429 (no retry) or replay non-retryable
 * errors (auth failures spammed at the provider).
 */
describe('withProviderRetry', () => {
  beforeEach(() => {
    // Math.random returns 0 inside this block so jitter is zero — tests
    // become deterministic.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the value on first-attempt success without sleeping', async () => {
    const fn = vi.fn(async () => 'ok');
    const promise = withProviderRetry(fn, { label: 'test' });
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable PaymentProviderError up to maxAttempts', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new PaymentProviderError('RATE_LIMITED', 'slow down', { retryable: true }),
      )
      .mockRejectedValueOnce(new PaymentProviderError('NETWORK', 'transient', { retryable: true }))
      .mockResolvedValueOnce('finally');

    const promise = withProviderRetry(fn, {
      label: 'test',
      backoffMs: [10, 20],
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-retryable PaymentProviderError', async () => {
    const fn = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new PaymentProviderError('AUTH_FAILED', 'bad key', { retryable: false }));

    await expect(withProviderRetry(fn, { label: 'test' })).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a generic Error (not a PaymentProviderError)', async () => {
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('db blew up'));
    await expect(withProviderRetry(fn, { label: 'test' })).rejects.toThrow('db blew up');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-throws after exhausting maxAttempts', async () => {
    const err = new PaymentProviderError('SERVER_ERROR', 'still down', { retryable: true });
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(err);

    const promise = withProviderRetry(fn, {
      label: 'test',
      backoffMs: [10, 20],
    });
    // Attach the rejection catcher BEFORE advancing timers so Vitest sees
    // the rejection as handled. Otherwise the inner retry's pending
    // rejection leaks as an unhandled-rejection error.
    const assertion = expect(promise).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    // backoffs.length + 1 = 3 attempts total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors explicit maxAttempts even when smaller than backoffMs.length + 1', async () => {
    const err = new PaymentProviderError('SERVER_ERROR', 'still down', { retryable: true });
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(err);

    const promise = withProviderRetry(fn, {
      label: 'test',
      backoffMs: [10, 20, 40, 80],
      maxAttempts: 2,
    });
    const assertion = expect(promise).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('accepts a duck-typed retryable error (e.g. PlatformZiinaError)', async () => {
    // The retry layer matches on shape (`code: string`, `retryable:
    // boolean`) to avoid coupling the billing tree to the payment-
    // adapter PaymentProviderError class.
    const duck: { code: string; retryable: boolean; message: string } = {
      code: 'PLATFORM_TRANSIENT',
      retryable: true,
      message: 'flap',
    };
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(duck)
      .mockResolvedValueOnce('ok');

    const promise = withProviderRetry(fn, { label: 'test', backoffMs: [10] });
    await vi.advanceTimersByTimeAsync(20);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
