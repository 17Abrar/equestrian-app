import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getUploadUrl, getFolderRoot, UPLOAD_FOLDER_PERMISSIONS } from '@/lib/storage';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  folder: z.string().min(1).max(100),
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

      try {
        const result = await getUploadUrl({
          clubId: ctx.clubId,
          folder: data.folder,
          fileName: data.fileName,
          contentType: data.contentType,
        });

        logger.info('upload_url_generated', {
          clubId: ctx.clubId,
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
