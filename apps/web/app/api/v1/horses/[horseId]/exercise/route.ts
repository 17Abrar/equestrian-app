import { type NextRequest } from 'next/server';
import { createExerciseScheduleSchema } from '@equestrian/shared/schemas';
import { getExerciseSchedules, createExerciseSchedule, getHorseById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  parsePagination,
  paginatedListResponse,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getExerciseSchedules(ctx.clubId, horseId, { page, pageSize });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);

      // Bind the horse to this tenant before insert — see medications/route.ts
      // for the cross-tenant write scenario this guards against.
      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      const data = await parseRequiredBody(request, createExerciseScheduleSchema);
      const schedule = await createExerciseSchedule(ctx.clubId, horseId, data);

      if (schedule) {
        void ctx.audit({
          action: 'exercise_schedule.create',
          resourceType: 'exercise_schedule',
          resourceId: schedule.id,
          changes: {
            horseId: { from: null, to: horseId },
          },
        });
      }

      return successResponse(schedule, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
