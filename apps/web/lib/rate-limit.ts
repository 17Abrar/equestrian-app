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

// Store on globalThis so it persists across hot-reloads in dev
// and shares state within a single serverless invocation.
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

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): RateLimitResult {
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

// Periodic cleanup to prevent memory growth in long-lived instances.
// Clear any previous interval (hot-reload safe).
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
