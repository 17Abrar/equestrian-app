import { type NextRequest } from 'next/server';
import { createLessonTypeSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getLessonTypesByClub, createLessonType } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
  paginatedResponse,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Audit S-1 + F-7 (2026-05-06): lesson types are pricing data
      // riders need to render the booking form. Accept the dedicated
      // `lesson_types:read` (coaches/grooms/admin/manager) or any
      // booking-create grant — staff (`bookings:read`), riders
      // (`bookings:create`), parents (`bookings:create_child`).
      //
      // Audit F-33 (2026-05-07 r4): the previous gate also accepted
      // `bookings:read_own` and `bookings:read_child`. Both are held by
      // roles that ALSO hold a booking-create grant (rider, parent), so
      // dropping them from the lesson-types gate doesn't lose any
      // legitimate access. But `bookings:read_own` is ALSO held by
      // `horse_owner` — a role that doesn't book lessons and shouldn't
      // need to enumerate the pricing catalog. Tightening here closes
      // the soft pricing leak the audit flagged.
      const canRead =
        hasPermission(ctx.orgRole, 'lesson_types:read') ||
        hasPermission(ctx.orgRole, 'bookings:read') ||
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
      const data = await parseRequiredBody(request, createLessonTypeSchema);

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
