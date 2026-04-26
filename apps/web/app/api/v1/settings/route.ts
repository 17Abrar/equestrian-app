import { type NextRequest } from 'next/server';
import {
  updateClubProfileSchema,
  updateBookingRulesSchema,
  updateBrandingSchema,
  updateNotificationsSchema,
  updateDiscoverySchema,
  type UpdateClubProfileInput,
  type UpdateBookingRulesInput,
  type UpdateBrandingInput,
  type UpdateNotificationsInput,
  type UpdateDiscoveryInput,
} from '@equestrian/shared/schemas';
import { getClubById, updateClubSettings } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

// Union of every settings sub-schema's *input* shape. Typing the merged
// PATCH payload as this — instead of `Record<string, unknown>` — means a
// future schema gets caught at compile time if one of its fields is not
// also a real settings field, and prevents the merge from silently picking
// up unrelated keys (e.g. a privileged column slipping in via copy-paste).
type SettingsPatchData = Partial<
  UpdateClubProfileInput &
    UpdateBookingRulesInput &
    UpdateBrandingInput &
    UpdateNotificationsInput &
    UpdateDiscoveryInput
>;

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

      const merged: SettingsPatchData = {
        ...(profileResult.success ? profileResult.data : {}),
        ...(rulesResult.success ? rulesResult.data : {}),
        ...(brandingResult.success ? brandingResult.data : {}),
        ...(notificationsResult.success ? notificationsResult.data : {}),
        ...(discoveryResult.success ? discoveryResult.data : {}),
      };

      if (Object.keys(merged).length === 0) {
        return errorResponse('VALIDATION_ERROR', 'No valid fields provided', 400);
      }

      // Split out the numeric fee fields and rebuild the payload — Drizzle's
      // `numeric` columns require strings (preserves precision), Zod gives us
      // numbers. Doing the split first instead of mutating-in-place keeps the
      // typed `merged` object intact for any future readers.
      const { lateCancellationFeePercent, noShowFeePercent, ...rest } = merged;
      const dbUpdate = {
        ...rest,
        ...(lateCancellationFeePercent !== undefined
          ? { lateCancellationFeePercent: String(lateCancellationFeePercent) }
          : {}),
        ...(noShowFeePercent !== undefined
          ? { noShowFeePercent: String(noShowFeePercent) }
          : {}),
      };

      const club = await updateClubSettings(ctx.clubId, dbUpdate);

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
