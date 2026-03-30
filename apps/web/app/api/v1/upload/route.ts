import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getUploadUrl } from '@/lib/storage';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
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
