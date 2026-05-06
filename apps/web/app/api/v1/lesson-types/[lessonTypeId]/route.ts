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
      // Audit S-1: same as the list endpoint — accept any booking-related
      // read/create grant so riders/parents can render the booking form.
      const canRead =
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
    { requiredPermission: 'bookings:update' },
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
    // Audit MED-1 (2026-05-05): align with the matrix. `bookings:delete`
    // wasn't in `permissions-shared.ts` — the route worked only because
    // both `club_admin` (`*`) and `club_manager` (`bookings:*`) match
    // via wildcard, and tightening the matrix later would silently 403
    // every non-admin role. `bookings:update` (matches PATCH on the
    // sibling endpoint) is the right gate here.
    { requiredPermission: 'bookings:update' },
  );
}
