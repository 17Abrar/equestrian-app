import { type NextRequest } from 'next/server';
import { createLessonTypeSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getLessonTypesByClub, createLessonType } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  paginatedResponse,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Audit S-1 + F-7 (2026-05-06): lesson types are pricing data
      // riders need to render the booking form. Accept the dedicated
      // `lesson_types:read` (coaches/grooms/admin/manager) or any
      // booking-related grant — staff (`bookings:read`), riders
      // (`bookings:read_own`), parents (`bookings:read_child`), or
      // anyone allowed to create bookings.
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

      const url = new URL(request.url);
      const { page, pageSize } = validateInput(paginationSchema, {
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getLessonTypesByClub(ctx.clubId, { page, pageSize });
      return paginatedResponse(items, { page, pageSize, total });
    },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createLessonTypeSchema, body);

      const lessonType = await createLessonType(ctx.clubId, data);

      if (!lessonType) {
        return errorResponse('CREATE_FAILED', 'Failed to create lesson type', 500);
      }

      void ctx.audit({
        action: 'lesson_type.create',
        resourceType: 'lesson_type',
        resourceId: lessonType.id,
      });

      return successResponse(lessonType, 201);
    },
    // Audit F-7 (2026-05-06): dedicated `lesson_types:create` instead
    // of piggybacking on `bookings:update`. Lesson-type creation sets
    // prices used at booking time; the original gate's wildcard match
    // worked but coupled rider booking permissions with staff config.
    { requiredPermission: 'lesson_types:create' },
  );
}
