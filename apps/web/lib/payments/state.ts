import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed OAuth state tokens. We pass these as the `state` parameter during
 * Stripe Connect OAuth so we can (a) bind the callback to the club that
 * initiated the flow and (b) defend against CSRF without a cookie round-trip.
 *
 * Format (base64url-encoded):
 *   clubId "." nonce "." timestamp "." hmac(clubId.nonce.timestamp, key)
 *
 * The signing key is derived from ENCRYPTION_KEY (already required by the
 * field-level crypto layer) so we don't introduce a new secret.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

function getSigningKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is required to sign OAuth state tokens');
  }
  return key;
}

export function signOAuthState(clubId: string): string {
  const nonce = randomBytes(12).toString('hex');
  const timestamp = Date.now();
  const payload = `${clubId}.${nonce}.${timestamp}`;
  const sig = createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyOAuthState(
  encoded: string,
): { clubId: string; timestamp: number } | null {
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

    return { clubId, timestamp };
  } catch {
    return null;
  }
}
