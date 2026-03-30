import { type NextRequest } from 'next/server';
import { updateExerciseScheduleSchema } from '@equestrian/shared/schemas';
import { updateExerciseSchedule, deleteExerciseSchedule } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; scheduleId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, scheduleId } = await params;
      const body = await request.json();
      const data = validateInput(updateExerciseScheduleSchema, body);
      const schedule = await updateExerciseSchedule(ctx.clubId, horseId, scheduleId, data);

      if (!schedule) {
        return errorResponse('NOT_FOUND', 'Exercise schedule not found', 404);
      }

      return successResponse(schedule);
    },
    { requiredPermission: 'horses:update_care' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, scheduleId } = await params;
      const result = await deleteExerciseSchedule(ctx.clubId, horseId, scheduleId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Exercise schedule not found', 404);
      }

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'horses:update_care' },
  );
}
