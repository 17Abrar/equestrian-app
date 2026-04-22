import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
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

if (g[INTERVAL_KEY]) {
  clearInterval(g[INTERVAL_KEY]);
}
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
    } catch {
      // If Upstash is briefly unavailable, fail open rather than block all
      // traffic. In-memory still provides a loose cap inside the hot instance.
      return inMemoryCheck(key, config);
    }
  }
  return inMemoryCheck(key, config);
}
