import { Redis } from '@upstash/redis';
import { logger } from './logger';

/**
 * Shared Upstash Redis client. Reused by the rate limiter, the OAuth
 * state nonce store, and any other transient-state feature that wants a
 * small shared KV.
 *
 * `getRedis()` returns `null` when Upstash isn't configured (local dev
 * without the env vars). Callers decide how to degrade: the rate
 * limiter falls back to in-memory counters; the OAuth nonce store skips
 * the check and relies on the OAuth code's single-use property. Always
 * log a warning so this path is visible in Sentry.
 */
let redisClient: Redis | null = null;
let resolvedClient = false;

export function getRedis(): Redis | null {
  if (resolvedClient) return redisClient;
  resolvedClient = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

/** Reset the memoised client. Intended for tests. */
export function __resetRedisForTest(): void {
  redisClient = null;
  resolvedClient = false;
}

export function logRedisUnavailable(context: string, err: unknown): void {
  logger.warn('redis_unavailable', {
    context,
    error: err instanceof Error ? err.message : 'unknown',
  });
}
