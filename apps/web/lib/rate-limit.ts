import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from './logger';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  /**
   * When true, an Upstash failure returns `allowed: false` instead of
   * falling back to per-isolate in-memory counters. Use this on
   * burst-sensitive endpoints (slug enumeration, coupon validation) where
   * the cost of locking out a few legitimate users during a Redis blip is
   * lower than the cost of letting an attacker hammer them unthrottled.
   */
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60_000,
};

// ─── Upstash path ────────────────────────────────────────────────────

function isUpstashConfigured(): boolean {
  return !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
}

let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (redisClient) return redisClient;
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redisClient;
}

// One Ratelimit instance per unique (maxRequests, windowMs) pair. Creating
// a new Ratelimit for every request is cheap but caching avoids recomputing
// the sliding-window Lua script on each construction.
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(config: RateLimitConfig): Ratelimit {
  const key = `${config.maxRequests}:${config.windowMs}`;
  let limiter = limiterCache.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),
      // Sliding window is more accurate than fixed window under bursty traffic
      // — costs two counter lookups per check but keeps burst leakage bounded.
      limiter: Ratelimit.slidingWindow(
        config.maxRequests,
        `${Math.max(1, Math.round(config.windowMs / 1000))} s`,
      ),
      analytics: false,
      // Prefix keys so other apps sharing the same Upstash DB don't collide.
      prefix: 'equestrian:rl',
    });
    limiterCache.set(key, limiter);
  }
  return limiter;
}

async function upstashCheck(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const result = await getLimiter(config).limit(key);
  const retryAfterMs = result.success ? null : Math.max(0, result.reset - Date.now());
  return {
    allowed: result.success,
    remaining: Math.max(0, result.remaining),
    retryAfterMs,
  };
}

// ─── In-memory fallback ──────────────────────────────────────────────
// Used only when Upstash env vars aren't set (typically local dev). This
// shares state within a single serverless instance only, so it does NOT
// effectively rate-limit in production — Upstash is required for real
// protection.

const STORE_KEY = '__rateLimitStore';
const INTERVAL_KEY = '__rateLimitCleanupInterval';

interface RateLimitGlobals {
  [STORE_KEY]?: Map<string, number[]>;
  [INTERVAL_KEY]?: ReturnType<typeof setInterval>;
}

const g = globalThis as unknown as RateLimitGlobals;

if (!g[STORE_KEY]) {
  g[STORE_KEY] = new Map<string, number[]>();
}
const store = g[STORE_KEY];

function inMemoryCheck(key: string, config: RateLimitConfig): RateLimitResult {
  ensureCleanupStarted();
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= config.maxRequests) {
    const oldestInWindow = timestamps[0]!;
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    store.set(key, timestamps);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  timestamps.push(now);
  store.set(key, timestamps);

  return {
    allowed: true,
    remaining: config.maxRequests - timestamps.length,
    retryAfterMs: null,
  };
}

const CLEANUP_INTERVAL_MS = 300_000;
const MAX_WINDOW_MS = 120_000;

// Lazy: the cleanup interval starts on first in-memory check rather than at
// module init. A previous module-init `setInterval` fired for every Worker
// isolate cold-start, including isolates that only ever serve Upstash-backed
// production routes — wasted CPU + kept isolates alive longer than necessary.
function ensureCleanupStarted(): void {
  if (g[INTERVAL_KEY]) return;
  g[INTERVAL_KEY] = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store) {
      const filtered = timestamps.filter((t) => t > now - MAX_WINDOW_MS);
      if (filtered.length === 0) {
        store.delete(key);
      } else {
        store.set(key, filtered);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Returns whether `key` may proceed under `config`. In production, backed by
 * Upstash Redis (sliding window). In dev/when Upstash env vars are missing,
 * falls back to per-instance in-memory — acceptable for local testing but
 * not for real abuse protection.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  if (isUpstashConfigured()) {
    try {
      return await upstashCheck(key, config);
    } catch (err) {
      // Surface the outage so a sustained Redis problem isn't silent. Logged
      // at warn so it lights up Sentry without paging.
      logger.warn('rate_limit_fallback_to_memory', {
        key,
        failClosed: !!config.failClosed,
        error: err instanceof Error ? err.message : 'unknown',
      });
      if (config.failClosed) {
        // Burst-sensitive endpoints opt into this — better to bounce a real
        // user during a Redis blip than to let an attacker walk through. The
        // user can retry; abuse protection holds.
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.min(config.windowMs, 30_000),
        };
      }
      // Default: fall back to per-isolate in-memory. On Cloudflare Workers
      // this barely throttles (each isolate has its own counter) but it
      // beats locking out every customer over a transient outage.
      return inMemoryCheck(key, config);
    }
  }
  return inMemoryCheck(key, config);
}
