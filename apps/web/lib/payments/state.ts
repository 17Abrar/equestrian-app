import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getRedis, logRedisUnavailable } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * Signed OAuth state tokens. We pass these as the `state` parameter during
 * Stripe Connect OAuth so we can (a) bind the callback to the club that
 * initiated the flow and (b) defend against CSRF + replay without a cookie
 * round-trip.
 *
 * Format (base64url-encoded):
 *   clubId "." nonce "." timestamp "." hmac(clubId.nonce.timestamp, key)
 *
 * The signing key is derived from ENCRYPTION_KEY (already required by the
 * field-level crypto layer) so we don't introduce a new secret.
 *
 * Replay defence: at sign time we also write the nonce to Redis with the
 * same TTL. At verify time we DELETE the nonce — a DELETE returning 0
 * means the nonce was already consumed (or never existed), i.e. this is a
 * replay of a previously-verified state. Redis being unreachable
 * degrades to "signature + timestamp only" checks; a Stripe OAuth `code`
 * is already single-use at Stripe's end so the real-world replay window
 * stays closed.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_TTL_SECONDS = Math.ceil(STATE_TTL_MS / 1000);
const NONCE_PREFIX = 'equestrian:oauth_state:';

function getSigningKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is required to sign OAuth state tokens');
  }
  return key;
}

async function storeNonce(nonce: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    // `EX` ties the nonce lifetime to the state's advertised TTL — Redis
    // expires it even if the verify path never runs (user abandoned the
    // Stripe consent screen).
    await redis.set(`${NONCE_PREFIX}${nonce}`, '1', { ex: STATE_TTL_SECONDS });
  } catch (err) {
    logRedisUnavailable('oauth_state_sign', err);
  }
}

/**
 * Atomically consumes a nonce. Returns:
 *   - `'consumed'`  — nonce existed and we deleted it (first-use).
 *   - `'replay'`    — nonce was not present (already consumed or expired).
 *   - `'unknown'`   — Redis unavailable; caller should NOT treat as replay.
 */
async function consumeNonce(nonce: string): Promise<'consumed' | 'replay' | 'unknown'> {
  const redis = getRedis();
  if (!redis) return 'unknown';
  try {
    const deleted = await redis.del(`${NONCE_PREFIX}${nonce}`);
    return deleted > 0 ? 'consumed' : 'replay';
  } catch (err) {
    logRedisUnavailable('oauth_state_verify', err);
    return 'unknown';
  }
}

export async function signOAuthState(clubId: string): Promise<string> {
  const nonce = randomBytes(12).toString('hex');
  const timestamp = Date.now();
  const payload = `${clubId}.${nonce}.${timestamp}`;
  const sig = createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  await storeNonce(nonce);
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export async function verifyOAuthState(
  encoded: string,
): Promise<{ clubId: string; timestamp: number } | null> {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [clubId, nonce, timestampStr, providedSig] = parts;
    if (!clubId || !nonce || !timestampStr || !providedSig) return null;

    const expected = createHmac('sha256', getSigningKey())
      .update(`${clubId}.${nonce}.${timestampStr}`)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(providedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const timestamp = Number.parseInt(timestampStr, 10);
    if (!Number.isFinite(timestamp)) return null;
    if (Date.now() - timestamp > STATE_TTL_MS) return null;

    const nonceResult = await consumeNonce(nonce);
    if (nonceResult === 'replay') return null;

    return { clubId, timestamp };
  } catch (err) {
    // Surface internal failures (decode, HMAC compute, Redis bug, ENCRYPTION_KEY
    // rotation gone wrong) instead of squashing them to "invalid state" — the
    // caller renders that as a generic OAuth error with no operator visibility.
    logger.warn('oauth_state_verify_threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
