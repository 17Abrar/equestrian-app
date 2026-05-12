import { type NextRequest } from 'next/server';
import { updateExerciseScheduleSchema } from '@equestrian/shared/schemas';
import { updateExerciseSchedule, deleteExerciseSchedule } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; scheduleId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, scheduleId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('scheduleId', scheduleId);
      const data = await parseRequiredBody(request, updateExerciseScheduleSchema);
      const schedule = await updateExerciseSchedule(ctx.clubId, horseId, scheduleId, data);

      if (!schedule) {
        return errorResponse('NOT_FOUND', 'Exercise schedule not found', 404);
      }

      void ctx.audit({
        action: 'exercise_schedule.update',
        resourceType: 'exercise_schedule',
        resourceId: scheduleId,
        changes: {
          horseId: { from: null, to: horseId },
        },
      });

      return successResponse(schedule);
    },
    { requiredPermission: 'horses:update_care' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, scheduleId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('scheduleId', scheduleId);
      const result = await deleteExerciseSchedule(ctx.clubId, horseId, scheduleId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Exercise schedule not found', 404);
      }

      void ctx.audit({
        action: 'exercise_schedule.delete',
        resourceType: 'exercise_schedule',
        resourceId: scheduleId,
        changes: {
          horseId: { from: null, to: horseId },
        },
      });

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'horses:update_care' },
  );
}
