import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@equestrian/db';
import { clubMembers } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  getUploadUrl,
  getFolderRoot,
  UPLOAD_FOLDER_PERMISSIONS,
  MAX_UPLOAD_SIZE_BYTES,
} from '@/lib/storage';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  folder: z.string().min(1).max(100),
  // Declared size is bound into the R2 signature via ContentLength — a PUT
  // that doesn't match fails with a signature error, closing the previous
  // unbounded-upload hole. Max is enforced here as well.
  fileSizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
  // Optional override: upload under a different club the user belongs to.
  // Used by the rider horse-registration flow — the rider's active tenant
  // may not be the target stable, and we want the photo to live under the
  // target stable's R2 prefix. Membership re-check prevents abuse.
  targetClubId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(uploadRequestSchema, body);

      const root = getFolderRoot(data.folder);
      if (!root) {
        return errorResponse('INVALID_FOLDER', 'Unknown upload folder', 400);
      }

      // Horses are the one folder where owners (horses:update_own) are valid
      // uploaders even though they lack the cross-club `horses:update` permission.
      const basePermission = UPLOAD_FOLDER_PERMISSIONS[root]!;
      const allowed = root === 'horses'
        ? hasPermission(ctx.orgRole, 'horses:update') ||
          hasPermission(ctx.orgRole, 'horses:update_own')
        : hasPermission(ctx.orgRole, basePermission);

      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to upload to this folder',
          403,
        );
      }

      let uploadClubId = ctx.clubId;
      if (data.targetClubId && data.targetClubId !== ctx.clubId) {
        // User wants to upload against a different club than their active
        // tenant. Allowed only if they're an active member of that club
        // (prevents a forged clubId from putting files into arbitrary buckets).
        const membership = await db
          .select({ id: clubMembers.id })
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
        throw err;
      }
    },
  );
}
