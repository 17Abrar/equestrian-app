import { type NextRequest } from 'next/server';
import { updateLessonTypeSchema } from '@equestrian/shared/schemas';
import { getLessonTypeById, updateLessonType, deleteLessonType } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ lessonTypeId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { lessonTypeId } = await params;
      const lessonType = await getLessonTypeById(ctx.clubId, lessonTypeId);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      return successResponse(lessonType);
    },
    { requiredPermission: 'bookings:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { lessonTypeId } = await params;
      const body = await request.json();
      const data = validateInput(updateLessonTypeSchema, body);

      const lessonType = await updateLessonType(ctx.clubId, lessonTypeId, data);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      return successResponse(lessonType);
    },
    { requiredPermission: 'bookings:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { lessonTypeId } = await params;
      const lessonType = await deleteLessonType(ctx.clubId, lessonTypeId);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      return successResponse(lessonType);
    },
    { requiredPermission: 'bookings:delete' },
  );
}
