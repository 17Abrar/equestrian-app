import { type NextRequest } from 'next/server';
import {
  updateClubProfileSchema,
  updateBookingRulesSchema,
  updateBrandingSchema,
  updateNotificationsSchema,
  updateDiscoverySchema,
} from '@equestrian/shared/schemas';
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

      // Accept any combination of profile, booking rules, branding, or
      // notification updates in a single PATCH. Unknown keys are ignored
      // silently by each schema's strip-by-default behavior — Zod's
      // default is to drop unrecognised keys, NOT reject (.strict()) them.
      const profileResult = updateClubProfileSchema.safeParse(body);
      const rulesResult = updateBookingRulesSchema.safeParse(body);
      const brandingResult = updateBrandingSchema.safeParse(body);
      const notificationsResult = updateNotificationsSchema.safeParse(body);
      const discoveryResult = updateDiscoverySchema.safeParse(body);

      const data: Record<string, unknown> = {
        ...(profileResult.success ? profileResult.data : {}),
        ...(rulesResult.success ? rulesResult.data : {}),
        ...(brandingResult.success ? brandingResult.data : {}),
        ...(notificationsResult.success ? notificationsResult.data : {}),
        ...(discoveryResult.success ? discoveryResult.data : {}),
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
