import { type NextRequest } from 'next/server';
import { createFeedingPlanSchema } from '@equestrian/shared/schemas';
import { getFeedingPlans, createFeedingPlan, getHorseById } from '@equestrian/db/queries';
import { withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  parsePagination,
  paginatedListResponse, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getFeedingPlans(ctx.clubId, horseId, { page, pageSize });
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

      const data = await parseRequiredBody(request, createFeedingPlanSchema);
      const plan = await createFeedingPlan(ctx.clubId, horseId, data);

      if (plan) {
        void ctx.audit({
          action: 'feeding_plan.create',
          resourceType: 'feeding_plan',
          resourceId: plan.id,
          changes: {
            horseId: { from: null, to: horseId },
          },
        });
      }

      return successResponse(plan, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
