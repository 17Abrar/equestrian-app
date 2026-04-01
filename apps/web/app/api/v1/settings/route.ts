import { type NextRequest } from 'next/server';
import { updateClubProfileSchema, updateBookingRulesSchema } from '@equestrian/shared/schemas';
import { getClubById, updateClubSettings } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

export async function GET() {
  return withAuth(
    async (ctx) => {
      const club = await getClubById(ctx.clubId);

      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      return successResponse(club);
    },
    { requiredPermission: 'settings:read' },
  );
}

export async function PATCH(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();

      // Accept either profile or booking rules update
      const profileResult = updateClubProfileSchema.safeParse(body);
      const rulesResult = updateBookingRulesSchema.safeParse(body);

      const data: Record<string, unknown> = {
        ...(profileResult.success ? profileResult.data : {}),
        ...(rulesResult.success ? rulesResult.data : {}),
      };

      if (Object.keys(data).length === 0) {
        return errorResponse('VALIDATION_ERROR', 'No valid fields provided', 400);
      }

      // Drizzle numeric columns expect strings — convert fee percentages
      if (data.lateCancellationFeePercent !== undefined) {
        data.lateCancellationFeePercent = String(data.lateCancellationFeePercent);
      }
      if (data.noShowFeePercent !== undefined) {
        data.noShowFeePercent = String(data.noShowFeePercent);
      }

      const club = await updateClubSettings(ctx.clubId, data);

      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      void ctx.audit({
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: ctx.clubId,
      });

      return successResponse(club);
    },
    { requiredPermission: 'settings:update' },
  );
}
