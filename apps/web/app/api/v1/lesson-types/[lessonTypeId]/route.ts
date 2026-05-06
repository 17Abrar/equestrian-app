import { type NextRequest } from 'next/server';
import { updateLessonTypeSchema } from '@equestrian/shared/schemas';
import { getLessonTypeById, updateLessonType, deleteLessonType } from '@equestrian/db/queries';
import { withAuth,
  successResponse,
  errorResponse,
  validateInput, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ lessonTypeId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      // Audit S-1 + F-7 (2026-05-06): same as the list endpoint — accept
      // the dedicated `lesson_types:read` or any booking-related grant.
      const canRead =
        hasPermission(ctx.orgRole, 'lesson_types:read') ||
        hasPermission(ctx.orgRole, 'bookings:read') ||
        hasPermission(ctx.orgRole, 'bookings:read_own') ||
        hasPermission(ctx.orgRole, 'bookings:read_child') ||
        hasPermission(ctx.orgRole, 'bookings:create') ||
        hasPermission(ctx.orgRole, 'bookings:create_child');
      if (!canRead) {
        return errorResponse('FORBIDDEN', 'You do not have permission to view lesson types', 403);
      }

      const { lessonTypeId } = await params;

      validateUuidParam('lessonTypeId', lessonTypeId);
      const lessonType = await getLessonTypeById(ctx.clubId, lessonTypeId);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      return successResponse(lessonType);
    },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { lessonTypeId } = await params;
      validateUuidParam('lessonTypeId', lessonTypeId);
      const body = await request.json();
      const data = validateInput(updateLessonTypeSchema, body);

      const lessonType = await updateLessonType(ctx.clubId, lessonTypeId, data);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      void ctx.audit({
        action: 'lesson_type.update',
        resourceType: 'lesson_type',
        resourceId: lessonTypeId,
      });

      return successResponse(lessonType);
    },
    // Audit F-7 (2026-05-06): dedicated lesson_types resource instead
    // of piggybacking on bookings:update.
    { requiredPermission: 'lesson_types:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { lessonTypeId } = await params;
      validateUuidParam('lessonTypeId', lessonTypeId);
      const lessonType = await deleteLessonType(ctx.clubId, lessonTypeId);

      if (!lessonType) {
        return errorResponse('NOT_FOUND', 'Lesson type not found', 404);
      }

      void ctx.audit({
        action: 'lesson_type.delete',
        resourceType: 'lesson_type',
        resourceId: lessonTypeId,
      });

      return successResponse(lessonType);
    },
    // Audit F-7 (2026-05-06): dedicated lesson_types:delete.
    { requiredPermission: 'lesson_types:delete' },
  );
}
