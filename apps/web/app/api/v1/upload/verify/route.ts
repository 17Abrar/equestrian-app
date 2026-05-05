import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
import { deleteR2Object, verifyObjectMagicBytes } from '@/lib/storage';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const verifyRequestSchema = z.object({
  /** The key returned by `POST /api/v1/upload` (e.g. `"<clubId>/horses/photos/<ts>-<name>"`). */
  key: z.string().min(1).max(500),
  /** The content-type originally declared at presign time — we re-check the
   *  actual file bytes against this. */
  contentType: z.string().min(1).max(100),
});

const KEY_PATTERN = /^[0-9a-f-]{36}\/[a-z][a-z0-9_/-]*\/\d+-[a-z0-9._-]+$/;

/**
 * Post-upload verification. Client uploads the file directly to R2 via
 * the presigned URL, then calls this endpoint with the key. We fetch
 * the first bytes, compare magic bytes against the declared content
 * type, and delete the object if they don't match.
 *
 * Rationale (audit 2026-04-24 LOW #18): the presigned-PUT path binds
 * `Content-Type` into the signature, but the actual file bytes are
 * never inspected. A malicious client can declare `image/jpeg` and
 * upload a PE/ELF/script, which R2 then hosts at the object's public
 * URL with that bogus type. Browsers usually won't execute based on
 * content-type alone (`X-Content-Type-Options: nosniff` is set in
 * `next.config.ts`), but that's mitigation, not prevention — mis-typed
 * files still reach third-party viewers, image-processing pipelines,
 * and email attachments downstream.
 *
 * This route is idempotent (safe to retry) and cheap (reads 16 bytes).
 * Callers block on this before persisting the URL to a record. If
 * verification 5xx's, the object stays in R2 and the client can retry
 * — the save-path in the calling feature is the gate, not this route.
 */
export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(verifyRequestSchema, body);

      // Keys look like "<clubId>/<folder>/<ts>-<name>". Validate shape
      // before we go near the S3 API so a malformed key can't be weaponised
      // (e.g. a key with `..` that would otherwise 404).
      if (!KEY_PATTERN.test(data.key)) {
        return errorResponse('INVALID_KEY', 'Unrecognised object key', 400);
      }

      // Prefix-bind the key to a club the caller is a member of. Without
      // this, any authenticated user could probe / delete any other club's
      // uploads by guessing keys.
      const keyClubId = data.key.split('/')[0]!;
      if (keyClubId !== ctx.clubId) {
        const membership = await db
          .select({ id: clubMembers.id })
          .from(clubMembers)
          .where(
            and(
              eq(clubMembers.clubId, keyClubId),
              eq(clubMembers.clerkUserId, ctx.userId),
              eq(clubMembers.isActive, true),
            ),
          )
          .limit(1);
        if (!membership[0]) {
          // Audit F-9 (2026-05-05): emit a structured warn so a flood of
          // cross-stable rejections from one userId — i.e., someone
          // probing other clubs' R2 keys — surfaces in observability
          // alongside the standard 403. Sentry forwards `warn` per
          // logger.ts's level mapping.
          logger.warn('upload_verify_cross_stable_blocked', {
            ctxClubId: ctx.clubId,
            keyClubId,
            userId: ctx.userId,
            keyPrefix: data.key.slice(0, 80),
          });
          return errorResponse(
            'FORBIDDEN',
            'You do not have access to this upload',
            403,
          );
        }
      }

      let result;
      try {
        result = await verifyObjectMagicBytes(data.key, data.contentType);
      } catch (err) {
        logger.warn('upload_verify_failed', {
          clubId: ctx.clubId,
          key: data.key,
          error: err instanceof Error ? err.message : 'unknown',
        });
        return errorResponse(
          'VERIFY_FAILED',
          'Could not verify uploaded file. Please try uploading again.',
          502,
        );
      }

      if (!result.ok) {
        logger.warn('upload_magic_byte_mismatch', {
          clubId: ctx.clubId,
          key: data.key,
          declaredType: result.declaredType,
          detectedType: result.detectedType ?? 'unknown',
        });

        // Fire-and-forget delete — keeping the mis-typed object around is
        // worse than a failed delete (storage cost + abuse surface).
        await deleteR2Object(data.key);

        void ctx.audit({
          action: 'file.upload_rejected',
          resourceType: 'file',
          changes: {
            key: { from: null, to: data.key },
            declaredType: { from: null, to: result.declaredType },
            detectedType: { from: null, to: result.detectedType ?? 'unknown' },
          },
        });

        return errorResponse(
          'FILE_TYPE_MISMATCH',
          result.detectedType
            ? `File contents (${result.detectedType}) do not match declared type (${result.declaredType}).`
            : `File does not match any allowed type — expected ${result.declaredType}.`,
          422,
        );
      }

      return successResponse({ ok: true });
    },
  );
}
