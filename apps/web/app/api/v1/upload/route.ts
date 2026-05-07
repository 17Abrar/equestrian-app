import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
import { type UserRole } from '@equestrian/shared/types';
import {
  getUploadUrl,
  getFolderRoot,
  UPLOAD_FOLDER_PERMISSIONS,
  maxUploadSizeFor,
} from '@/lib/storage';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

// Declared size is bound into the R2 signature via ContentLength — a PUT
// that doesn't match fails with a signature error, closing the previous
// unbounded-upload hole. The cap is enforced here per content type
// (15 MB for images, 25 MB for documents) so the route returns a clean
// 400 VALIDATION_ERROR before getUploadUrl ever runs. The previous
// shape (`.max(<single 25 MB cap>)`) accepted up to 25 MB for any type,
// then the storage layer would re-throw "File is too large…" — which
// the catch handler below didn't recognize, surfacing the size violation
// as an opaque 500.
const uploadRequestSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1),
    folder: z.string().min(1).max(100),
    fileSizeBytes: z.number().int().positive(),
    // Optional override: upload under a different club the user belongs
    // to. Used by the rider horse-registration flow — the rider's active
    // tenant may not be the target stable, and we want the photo to live
    // under the target stable's R2 prefix. Membership re-check prevents
    // abuse.
    targetClubId: z.string().uuid().optional(),
  })
  // Audit F-2 (2026-05-06): `.strict()` MUST precede `.superRefine` —
  // ZodEffects produced by `.superRefine` doesn't expose `.strict()`.
  // Without this, an unknown body key (`isAdmin`, etc.) was silently
  // dropped instead of 400'ing.
  .strict()
  .superRefine((data, ctx) => {
    const max = maxUploadSizeFor(data.contentType);
    if (data.fileSizeBytes > max) {
      const maxMb = Math.floor(max / (1024 * 1024));
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: 'number',
        maximum: max,
        inclusive: true,
        path: ['fileSizeBytes'],
        message: `File is too large for ${data.contentType}. Maximum size is ${maxMb} MB.`,
      });
    }
  });

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Audit F-63 (2026-05-07 r5).
      const data = await parseRequiredBody(request, uploadRequestSchema);

      const root = getFolderRoot(data.folder);
      if (!root) {
        return errorResponse('INVALID_FOLDER', 'Unknown upload folder', 400);
      }

      // Resolve which club the file lands in AND the role the caller has
      // AT THAT CLUB. The permission gate must run against the role at the
      // target club, not the active tenant — otherwise a user who is admin
      // at A and rider at B can upload into B's admin-only folders by
      // forwarding their A-club permissions through `targetClubId`.
      let uploadClubId = ctx.clubId;
      let effectiveRole: UserRole = ctx.orgRole;
      if (data.targetClubId && data.targetClubId !== ctx.clubId) {
        const membership = await db
          .select({ id: clubMembers.id, role: clubMembers.role })
          .from(clubMembers)
          .where(
            and(
              eq(clubMembers.clubId, data.targetClubId),
              eq(clubMembers.clerkUserId, ctx.userId),
              eq(clubMembers.isActive, true),
            ),
          )
          .limit(1);

        if (!membership[0]) {
          return errorResponse(
            'NOT_A_MEMBER',
            'You are not a member of the target stable',
            403,
          );
        }
        uploadClubId = data.targetClubId;
        effectiveRole = membership[0].role;
      }

      // Horses are the one folder where owners (horses:update_own) are valid
      // uploaders even though they lack the cross-club `horses:update` permission.
      const basePermission = UPLOAD_FOLDER_PERMISSIONS[root]!;
      const allowed = root === 'horses'
        ? hasPermission(effectiveRole, 'horses:update') ||
          hasPermission(effectiveRole, 'horses:update_own')
        : hasPermission(effectiveRole, basePermission);

      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to upload to this folder',
          403,
        );
      }

      try {
        const result = await getUploadUrl({
          clubId: uploadClubId,
          folder: data.folder,
          fileName: data.fileName,
          contentType: data.contentType,
          fileSizeBytes: data.fileSizeBytes,
        });

        logger.info('upload_url_generated', {
          clubId: uploadClubId,
          folder: data.folder,
          fileName: data.fileName,
          key: result.key,
        });

        void ctx.audit({
          action: 'file.upload',
          resourceType: 'file',
          changes: {
            folder: { from: null, to: data.folder },
            fileName: { from: null, to: data.fileName },
            key: { from: null, to: result.key },
            targetClubId: { from: null, to: uploadClubId },
          },
        });

        return successResponse({
          uploadUrl: result.uploadUrl,
          publicUrl: result.publicUrl,
          key: result.key,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not allowed')) {
          return errorResponse('INVALID_FILE_TYPE', err.message, 400);
        }
        if (err instanceof Error && err.message.includes('not configured')) {
          return errorResponse('STORAGE_NOT_CONFIGURED', err.message, 503);
        }
        // Defense in depth — the Zod superRefine on `uploadRequestSchema`
        // should reject oversized uploads with VALIDATION_ERROR 400 before
        // reaching getUploadUrl, but storage.ts re-checks the cap and
        // throws on mismatch. Without this branch, that throw would
        // surface as a 500 INTERNAL_ERROR instead of a 400 the user can
        // act on.
        if (err instanceof Error && err.message.startsWith('File is too large')) {
          return errorResponse('FILE_TOO_LARGE', err.message, 400);
        }
        throw err;
      }
    },
    // Tighter than the default 60/min — uploads consume R2 storage and
    // egress, and the existing folder structure (`horses/photos` etc.)
    // doesn't pin a key to a single rider's resource. 10/min still
    // comfortably covers the legitimate flows (registration form,
    // documents tab) while bounding the abuse surface for any
    // authenticated rider in a club.
    // failClosed (audit LOW 2026-05-06) — Upstash outage must NOT lift
    // the cap on a route that mints presigned PUT URLs to R2.
    {
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'upload',
    },
  );
}
