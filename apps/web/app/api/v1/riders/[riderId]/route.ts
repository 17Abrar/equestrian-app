import { type NextRequest } from 'next/server';
import { updateRiderProfileSchema } from '@equestrian/shared/schemas';
import { getRiderById, updateRiderProfile } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ riderId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { riderId } = await params;
      validateUuidParam('riderId', riderId);
      const rider = await getRiderById(ctx.clubId, riderId);

      if (!rider) {
        return errorResponse('NOT_FOUND', 'Rider not found', 404);
      }

      return successResponse(rider);
    },
    { requiredPermission: 'riders:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { riderId } = await params;
      validateUuidParam('riderId', riderId);
      // Audit F-63 (2026-05-07 r5).
      const data = await parseRequiredBody(request, updateRiderProfileSchema);

      const rider = await updateRiderProfile(ctx.clubId, riderId, data);

      if (!rider) {
        return errorResponse('NOT_FOUND', 'Rider not found', 404);
      }

      void ctx.audit({
        action: 'rider.update',
        resourceType: 'rider',
        resourceId: riderId,
      });

      return successResponse(rider);
    },
    { requiredPermission: 'riders:update' },
  );
}
