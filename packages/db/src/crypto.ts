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
 * Encrypts every listed field on an object in place, returning a new object.
 * Useful for insert/update values where multiple sensitive columns need the
 * same treatment.
 */
export function encryptFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly (keyof T)[],
): T {
  const result: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string') {
      result[field as string] = encryptField(value);
    } else if (value === null) {
      result[field as string] = null;
    }
    // undefined is left as-is so partial updates don't overwrite existing values
  }
  return result as T;
}

/**
 * Decrypts every listed field on a row object, returning a new object with
 * plaintext values. Fields that weren't encrypted pass through unchanged.
 */
export function decryptFields<T extends Record<string, unknown>>(
  row: T,
  fields: readonly (keyof T)[],
): T {
  const result: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') {
      result[field as string] = decryptField(value);
    }
  }
  return result as T;
}
