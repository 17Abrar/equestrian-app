import { type NextRequest } from 'next/server';
import { createFeedingPlanSchema } from '@equestrian/shared/schemas';
import { getFeedingPlans, createFeedingPlan } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const plans = await getFeedingPlans(ctx.clubId, horseId);
      return successResponse(plans);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(createFeedingPlanSchema, body);
      const plan = await createFeedingPlan(ctx.clubId, horseId, data);
      return successResponse(plan, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
