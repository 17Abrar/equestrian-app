import { type NextRequest } from 'next/server';
import { updateFeedingPlanSchema } from '@equestrian/shared/schemas';
import { updateFeedingPlan, deleteFeedingPlan } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; planId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, planId } = await params;
      const body = await request.json();
      const data = validateInput(updateFeedingPlanSchema, body);
      const plan = await updateFeedingPlan(ctx.clubId, horseId, planId, data);

      if (!plan) {
        return errorResponse('NOT_FOUND', 'Feeding plan not found', 404);
      }

      void ctx.audit({
        action: 'feeding_plan.update',
        resourceType: 'feeding_plan',
        resourceId: planId,
        changes: {
          horseId: { from: null, to: horseId },
        },
      });

      return successResponse(plan);
    },
    { requiredPermission: 'horses:update_care' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, planId } = await params;
      const result = await deleteFeedingPlan(ctx.clubId, horseId, planId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Feeding plan not found', 404);
      }

      void ctx.audit({
        action: 'feeding_plan.delete',
        resourceType: 'feeding_plan',
        resourceId: planId,
        changes: {
          horseId: { from: null, to: horseId },
        },
      });

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'horses:update_care' },
  );
}
