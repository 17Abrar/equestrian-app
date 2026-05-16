import { type NextRequest } from 'next/server';
import { z } from 'zod';
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
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';

// Settings PATCH composes 5 sub-schemas, each `safeParse`d against the
// raw body. parseRequiredBody only enforces the body cap + JSON shape;
// the per-section parses below do the real validation. Passthrough so
// keys belonging to one schema reach the safeParse calls for the others.
const passthroughObjectSchema = z.object({}).passthrough();

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
      const body = await parseRequiredBody(request, passthroughObjectSchema);
      const source = body as Record<string, unknown>;

      // Audit 2026-05-13 (P2): pre-narrow keys per section before parsing.
      // Every section schema is `.strict()` (audit QA-25 / G-5), so
      // running each schema against the whole body — as the previous
      // implementation did — caused every parse to fail on any
      // multi-section payload, returning a spurious "No valid fields
      // provided" 400. Hardcoded key buckets are explicit and survive a
      // future Zod version change to `_def.shape`.
      const pickKeys = (keys: readonly string[]): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in source) out[key] = source[key];
        }
        return out;
      };
      const PROFILE_KEYS = [
        'name',
        'email',
        'phone',
        'address',
        'city',
        'country',
        'timezone',
        'currency',
        'logoUrl',
        'websiteUrl',
        'socialInstagram',
        'socialFacebook',
        'socialTiktok',
        'description',
      ] as const;
      const RULES_KEYS = [
        'advanceBookingDays',
        'bookingCutoffHours',
        'cancellationNoticeHours',
        'bookingPaymentTimeoutMinutes',
        'defaultLessonDurationMinutes',
        'allowOverbooking',
        'overbookingLimit',
        'defaultCalendarView',
        'lateCancellationFeePercent',
        'noShowFeePercent',
      ] as const;
      const BRANDING_KEYS = [
        'brandPrimaryColor',
        'brandSecondaryColor',
        'logoUrl',
        'coverPhotoUrl',
        'faviconUrl',
      ] as const;
      const NOTIFICATIONS_KEYS = ['notificationPreferences'] as const;
      const DISCOVERY_KEYS = ['isPublicListing', 'joinPolicy', 'shortDescription'] as const;

      const profileResult = updateClubProfileSchema.safeParse(pickKeys(PROFILE_KEYS));
      const rulesResult = updateBookingRulesSchema.safeParse(pickKeys(RULES_KEYS));
      const brandingResult = updateBrandingSchema.safeParse(pickKeys(BRANDING_KEYS));
      const notificationsResult = updateNotificationsSchema.safeParse(pickKeys(NOTIFICATIONS_KEYS));
      const discoveryResult = updateDiscoverySchema.safeParse(pickKeys(DISCOVERY_KEYS));

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
      // Audit 2026-05-13 (P2): use `Number(v).toFixed(2)` so floating-point
      // artifacts like `0.1 + 0.2 → 0.30000000000000004` don't get written
      // through to a `numeric(5,2)` column. Postgres rounds it but the
      // round-trip no longer matches what the operator typed. Pitfall #4.
      const { lateCancellationFeePercent, noShowFeePercent, ...rest } = merged;
      const dbUpdate = {
        ...rest,
        ...(lateCancellationFeePercent !== undefined
          ? { lateCancellationFeePercent: Number(lateCancellationFeePercent).toFixed(2) }
          : {}),
        ...(noShowFeePercent !== undefined
          ? { noShowFeePercent: Number(noShowFeePercent).toFixed(2) }
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
