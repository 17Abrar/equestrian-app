import { type NextRequest } from 'next/server';
import { createLessonTypeSchema } from '@equestrian/shared/schemas';
import { getLessonTypesByClub, createLessonType } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';

export async function GET() {
  return withAuth(
    async (ctx) => {
      const data = await getLessonTypesByClub(ctx.clubId);
      return successResponse(data);
    },
    { requiredPermission: 'bookings:read' },
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
    // Lesson-type creation sets prices used at booking time; gating on
    // `bookings:create` (which riders hold for self-service booking) would
    // let any rider mint a price-1 lesson type and book against it. Match
    // the PATCH/DELETE handlers below — admin/manager only.
    { requiredPermission: 'bookings:update' },
  );
}
