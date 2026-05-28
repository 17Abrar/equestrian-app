import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for sensitive PHI-style data (vet diagnoses, treatments,
 * medical descriptions). Uses AES-256-GCM (authenticated encryption) with a random
 * 96-bit IV per ciphertext. The envelope is prefixed with a version tag so we can
 * rotate algorithms without a destructive re-encrypt migration.
 *
 * ENCRYPTION_KEY must be a 32-byte key encoded as either 64 hex chars or 44
 * base64 chars. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
 */

const VERSION_PREFIX = 'v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your environment.',
    );
  }

  // Audit H-1: refuse the textbook all-zeros placeholder in production. CI
  // and test harnesses use `'0'.repeat(64)` because the build never opens
  // a connection / never encrypts; a future code path that derives a
  // build-time constant from the key would otherwise silently inherit
  // a known-test value into the production bundle.
  if (process.env.NODE_ENV === 'production' && /^0+$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY in production is the all-zeros placeholder. Set a real key generated with `openssl rand -hex 32` in the deploy environment.',
    );
  }

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars).',
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Audit LOW (2026-05-06 closeout): exported so the web app's
 * `instrumentation.ts:register()` can validate the env var at app
 * boot rather than lazily on first encrypt. Throws the same errors as
 * `loadKey()` (missing env, all-zeros in production, wrong byte
 * count). Sub-millisecond cold-start cost. Idempotent — subsequent
 * calls hit the module-level cache.
 */
export function assertEncryptionKeyConfigured(): void {
  loadKey();
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;

  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return VERSION_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;

  // Pass through non-encrypted values so legacy plaintext rows (pre-encryption
  // migration) and seed data keep rendering. New writes always add the prefix.
  if (!ciphertext.startsWith(VERSION_PREFIX)) return ciphertext;

  const buf = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) return null;

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);

  const key = loadKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Tampering or key mismatch — surface as null rather than raw bytes.
    return null;
  }
}

/**
 * Encrypts the listed fields on an object, returning a NEW object that
 * contains ONLY the encrypted fields (those present on the input as a
 * string or `null`). Callers spread the result into a larger
 * insert/update values object so the encrypted columns overlay any
 * plaintext they may have set elsewhere.
 *
 * Audit I8 (2026-05-18): two intertwined changes from the original
 * `T extends Record<string, unknown> → T` shape:
 *   1. Generic bound widened to plain `T` + `K extends keyof T`. Typed
 *      interfaces like `HorseCreate` / `RiderProfileUpdate` don't
 *      carry an implicit index signature; under the old bound every
 *      call site laundered via `data as unknown as Record<string,
 *      unknown>` (audit F-29 documented the cast as intentional but
 *      the cast itself was the smell).
 *   2. Return type narrowed from full `T` to `Partial<Pick<T, K>>`.
 *      Returning the full input with encrypted columns replaced had a
 *      latent bug — callers spread `{ ...toDecimalStrings(data),
 *      ...encrypted, clubId }`, and the `...encrypted` spread silently
 *      overrode `toDecimalStrings`'s numeric→string conversion
 *      because `encrypted` carried back the original numeric
 *      `weightKg` from `data`. Surfaced by the I8 CI typecheck.
 *      Returning only the encrypted keys eliminates that
 *      spread-clobber path. Undefined fields are skipped entirely so
 *      PATCH semantics (omitted ≠ null) survive the spread.
 */
export function encryptFields<T, K extends keyof T>(
  data: T,
  fields: readonly K[],
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string') {
      // Safe internal cast: callers list only string-valued keys.
      result[field] = encryptField(value) as T[K];
    } else if (value === null) {
      result[field] = null as T[K];
    }
    // undefined: don't set the key on `result` — preserves PATCH
    // semantics (the caller's spread won't introduce an `undefined`
    // value that would clobber whatever the column already holds).
  }
  return result;
}

/**
 * Decrypts every listed field on a row object, returning a new object with
 * plaintext values. Fields that weren't encrypted pass through unchanged.
 *
 * Audit I8 (2026-05-18): bound widened to plain `T`. See `encryptFields`
 * for the full rationale.
 */
export function decryptFields<T, K extends keyof T>(
  row: T,
  fields: readonly K[],
): T {
  const result: T = { ...row };
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') {
      result[field] = decryptField(value) as T[K];
    }
  }
  return result;
}
