import { createHash } from 'node:crypto';
import { getRedis, logRedisUnavailable } from './redis';

/**
 * Audit follow-up (2026-05-08, R-5): Idempotency-Key support for
 * money-moving / capacity-consuming POST endpoints. The classic case:
 * client sends `POST /bookings`, server processes successfully, the
 * 201 response gets dropped on the network, client retries — without
 * dedup the retry creates a second booking (or hits the unique-slot
 * index and surfaces a confusing 409 the client can't reconcile to a
 * booking id).
 *
 * Stripe-style implementation:
 *
 * 1. Client opts in via `Idempotency-Key: <opaque-string>` request
 *    header. No header → current behaviour, no caching.
 * 2. Cache key is scoped by route + clubId + memberId + the key, so two
 *    different users (or two different clubs) using the same key never
 *    collide. The body fingerprint is stored alongside; a request with
 *    the same key but a different body returns 422 (Stripe matches
 *    this — protects clients from accidental key reuse hiding a
 *    semantically different request).
 * 3. Cache TTL is 24h, matching `upload-verify-cache.ts`. Long enough
 *    to absorb a sleepy mobile client that wakes up and retries an
 *    hour later, short enough that a key recycled tomorrow is
 *    intentional.
 * 4. Only 2xx/3xx/4xx responses are cached. 5xx are transient — the
 *    next retry should re-attempt rather than re-deliver an internal
 *    error. (Stripe caches anything non-5xx; we match.)
 * 5. When Redis is unavailable, the route degrades to "no dedup" — a
 *    rare retry-creates-duplicate case is acceptable when the platform
 *    KV is down; refusing the request would block all bookings under
 *    a partial-Redis outage. The slot's unique index is the
 *    correctness backstop.
 */

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// Idempotency-Key header values: alphanumerics + a small set of safe
// punctuation, 8-255 chars. Matches the shape Stripe accepts and rejects
// "" / spaces / control chars before they hit Redis.
const KEY_PATTERN = /^[A-Za-z0-9_.-]{8,255}$/;

/**
 * Returns the validated `Idempotency-Key` header, or `null` if absent or
 * malformed. Callers treat `null` as "no idempotency" (current behaviour).
 * A malformed value is silently treated as missing — the alternative is
 * surfacing a 400 to a client that may be a year-old mobile build, which
 * adds churn without improving correctness. Mis-shaped keys never reach
 * Redis.
 */
export function getIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get('Idempotency-Key');
  if (!raw) return null;
  if (!KEY_PATTERN.test(raw)) return null;
  return raw;
}

export function fingerprintBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body) ?? 'null')
    .digest('hex');
}

interface CachedEntry {
  status: number;
  body: unknown;
  fingerprint: string;
}

export type IdempotencyLookup =
  | { kind: 'hit'; status: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'miss' };

function cacheKey(
  scope: string,
  clubId: string,
  memberId: string | null,
  key: string,
): string {
  return `idemp:${scope}:${clubId}:${memberId ?? 'anon'}:${key}`;
}

export async function readIdempotency(
  scope: string,
  clubId: string,
  memberId: string | null,
  key: string,
  bodyFingerprint: string,
): Promise<IdempotencyLookup> {
  const redis = getRedis();
  if (!redis) return { kind: 'miss' };
  try {
    const cached = await redis.get<CachedEntry>(
      cacheKey(scope, clubId, memberId, key),
    );
    if (!cached) return { kind: 'miss' };
    if (cached.fingerprint !== bodyFingerprint) return { kind: 'mismatch' };
    return { kind: 'hit', status: cached.status, body: cached.body };
  } catch (err) {
    logRedisUnavailable('idempotency_read', err);
    return { kind: 'miss' };
  }
}

export async function writeIdempotency(
  scope: string,
  clubId: string,
  memberId: string | null,
  key: string,
  bodyFingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // Only cache non-5xx — transient internal errors should not be replayed.
  if (status >= 500) return;
  try {
    const entry: CachedEntry = { status, body, fingerprint: bodyFingerprint };
    await redis.set(cacheKey(scope, clubId, memberId, key), entry, {
      ex: IDEMPOTENCY_TTL_SECONDS,
    });
  } catch (err) {
    logRedisUnavailable('idempotency_write', err);
  }
}
