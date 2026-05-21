import { getRedis, logRedisUnavailable } from './redis';
import { deleteR2Object, verifyObjectMagicBytes } from './storage';
import { logger } from './logger';

/**
 * Audit F-8 (2026-05-08 r6): server-side gate for R2-uploaded files.
 *
 * Before this round, persistence routes (`documents` POST,
 * `horses.primaryPhotoUrl` PATCH, branding logo upload, etc.) trusted
 * that the client called `/api/v1/upload/verify` between presign and
 * persist. The only enforcement was in `apps/web/components/ui/file-
 * upload.tsx:124` (the web client). A direct API caller could call
 * `POST /api/v1/upload`, do the R2 PUT, skip `/verify`, and POST
 * `{ fileUrl: "<bogus>", … }` without the magic-byte check ever
 * running.
 *
 * This module adds the server-side gate. Persist routes call
 * `requireVerifiedR2Object` before inserting the row. If the verify
 * cache says the key is already verified (ok), we short-circuit. If
 * not, we run the verification inline. Mismatches delete the R2
 * object and return 422.
 *
 * Cache: Upstash Redis, keyed on the R2 object key. TTL of 24h
 * (longer than any plausible upload session, shorter than any
 * scenario where the file content could change — R2 keys are
 * timestamp-prefixed so re-uploads under the same key are vanishingly
 * rare). Cache MISS == "verify inline now"; cache HIT (ok) == "skip
 * the byte fetch."
 *
 * When Redis is unavailable, the gate degrades to "always verify
 * inline" — a small CPU/egress cost (~16 bytes per verify) but no
 * loss of correctness. The audit verify route also writes the cache
 * entry, so the typical successful upload path is "verify route
 * sets cache → persist route reads cache → no second R2 round-trip."
 */

const VERIFIED_TTL_SECONDS = 24 * 60 * 60;

function cacheKey(r2Key: string): string {
  return `r2-verified:${r2Key}`;
}

/**
 * Called by `/api/v1/upload/verify` after a successful magic-byte check.
 * Records the (key, contentType) tuple so the persist-side gate can
 * skip re-verification.
 */
export async function markR2KeyVerified(r2Key: string, contentType: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(cacheKey(r2Key), contentType, { ex: VERIFIED_TTL_SECONDS });
  } catch (err) {
    logRedisUnavailable('upload_verify_cache_set', err);
  }
}

export type RequireVerifiedR2Result =
  | { ok: true }
  | { ok: false; status: 422 | 502; code: string; message: string };

/**
 * Persist-side gate for an R2-uploaded file. Resolves to `{ ok: true }`
 * when the key is either cached-verified or successfully verified
 * inline; otherwise returns a structured error suitable for the
 * caller to surface to the client.
 *
 * `expectedContentType` is the type the persist-side route expects
 * to store (e.g. `documents.fileType`). When the cache says we
 * already verified a different contentType for this key, that's a
 * tampering signal and we re-verify rather than trust the cache.
 */
export async function requireVerifiedR2Object(
  r2Key: string,
  expectedContentType: string,
): Promise<RequireVerifiedR2Result> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey(r2Key));
      if (cached === expectedContentType) {
        return { ok: true };
      }
    } catch (err) {
      logRedisUnavailable('upload_verify_cache_get', err);
      // fall through to inline verification
    }
  }

  // Inline verification — same shape as `/api/v1/upload/verify`.
  let result;
  try {
    result = await verifyObjectMagicBytes(r2Key, expectedContentType);
  } catch (err) {
    logger.warn('upload_persist_verify_failed', {
      r2Key,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return {
      ok: false,
      status: 502,
      code: 'VERIFY_FAILED',
      message: 'Could not verify uploaded file. Please try uploading again.',
    };
  }

  if (!result.ok) {
    logger.warn('upload_persist_magic_byte_mismatch', {
      r2Key,
      declaredType: result.declaredType,
      detectedType: result.detectedType ?? 'unknown',
    });
    // Same fire-and-forget delete the verify route does.
    await deleteR2Object(r2Key);
    return {
      ok: false,
      status: 422,
      code: 'FILE_TYPE_MISMATCH',
      message: result.detectedType
        ? `File contents (${result.detectedType}) do not match declared type (${result.declaredType}).`
        : `File does not match any allowed type — expected ${result.declaredType}.`,
    };
  }

  // Cache the successful inline verification too.
  await markR2KeyVerified(r2Key, expectedContentType);
  return { ok: true };
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/[a-z][a-z0-9_/-]*\/\d+-[a-z0-9._-]+$/;

/**
 * Parses an R2 key out of a stored fileUrl. Returns null when the URL
 * doesn't carry a recognizable key shape OR when its origin does not
 * match `R2_PUBLIC_URL`.
 *
 * Audit pass-5 MED-1 (2026-05-21): the previous implementation accepted
 * any origin so long as the pathname matched `KEY_PATTERN`. A caller
 * could post `fileUrl: "https://attacker.example/<valid-r2-path>"` —
 * `requireVerifiedR2Object` would verify the real R2 object at the path
 * and pass, but the row stored the attacker URL, which then rendered as
 * a trusted "document" link in the dashboard. Pinning the origin to
 * `R2_PUBLIC_URL` closes that channel.
 *
 * If `R2_PUBLIC_URL` is unset or unparseable the helper returns null —
 * uploads can't work without the env anyway (`storage.ts` throws), and
 * a missing env should never silently downgrade the security boundary.
 */
export function extractR2KeyFromUrl(fileUrl: string): string | null {
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  if (!r2PublicUrl) return null;
  let r2Origin: string;
  try {
    r2Origin = new URL(r2PublicUrl).origin;
  } catch {
    return null;
  }
  try {
    const url = new URL(fileUrl);
    if (url.origin !== r2Origin) return null;
    // Strip leading slash from the pathname.
    const path = url.pathname.replace(/^\//, '');
    if (!KEY_PATTERN.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}
