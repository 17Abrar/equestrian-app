import { type NextRequest } from 'next/server';
import { createExerciseScheduleSchema } from '@equestrian/shared/schemas';
import { getExerciseSchedules, createExerciseSchedule } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const schedules = await getExerciseSchedules(ctx.clubId, horseId);
      return successResponse(schedules);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(createExerciseScheduleSchema, body);
      const schedule = await createExerciseSchedule(ctx.clubId, horseId, data);
      return successResponse(schedule, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
