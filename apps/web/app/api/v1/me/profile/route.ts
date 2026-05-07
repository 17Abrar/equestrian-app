import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { type UserRole } from '@equestrian/shared/types';
import { getRiderByMemberId, upsertRiderProfileByMember } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

// Rider-profile rows model rider-only attributes (skill level, emergency
// contacts, medical notes). Coaches/grooms/vets shouldn't accidentally
// create one for themselves and start showing up in rider reports. Audit
// AI-3.
const RIDER_PROFILE_ELIGIBLE_ROLES: UserRole[] = [
  'rider',
  'parent',
  'horse_owner',
  'club_admin',
];

export async function GET() {
  return withAuth(async (ctx) => {
    if (!ctx.memberId) {
      // Audit LOW (2026-05-05 pass 2): unify with `tenant.ts`'s
      // `NO_MEMBERSHIP` shape. Same condition (signed-in Clerk user
      // with no club_members row) was 404 here and 503 from the tenant
      // resolver, so a refresh during onboarding flipped the user
      // between two unrelated UX paths. Use 503 + the canonical code so
      // the front-end's existing membership-not-yet-synced handling
      // catches both surfaces.
      return errorResponse(
        'NO_MEMBERSHIP',
        'Your account is being prepared. Refresh in a moment.',
        503,
      );
    }

    const rider = await getRiderByMemberId(ctx.clubId, ctx.memberId);
    return successResponse(rider);
  });
}

// Fields a rider is allowed to edit on their own profile. Skill level is
// present — admins will often override it from the staff side, but the
// rider's self-reported level is a sensible default.
// Audit F-9 (2026-05-07 r4): `.strict()` BEFORE `.refine()` so unknown
// keys 422 instead of being silently stripped. `.refine()` returns
// ZodEffects which doesn't expose `.strict()`, so the order matters.
// Without this, a future contributor widening `upsertRiderProfileByMember`
// to spread the parsed payload would let smuggled fields like
// `totalLessonsCompleted` or `parentMemberId` reach the DB.
const updateMyProfileSchema = z
  .object({
    dateOfBirth: z.string().optional().nullable(),
    weightKg: z.number().positive().max(500).optional().nullable(),
    heightCm: z.number().positive().max(300).optional().nullable(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    emergencyContactName: z.string().max(255).optional().nullable(),
    emergencyContactPhone: z.string().max(50).optional().nullable(),
    emergencyContactRelation: z.string().max(100).optional().nullable(),
    medicalNotes: z.string().max(5000).optional().nullable(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export async function PATCH(request: NextRequest) {
  return withAuth(async (ctx) => {
    if (!ctx.memberId) {
      return errorResponse('NO_MEMBER', 'Member profile not found', 404);
    }

    if (!RIDER_PROFILE_ELIGIBLE_ROLES.includes(ctx.orgRole)) {
      return errorResponse(
        'NOT_RIDER_ELIGIBLE',
        'Only riders, parents, owners, and admins can have a rider profile.',
        403,
      );
    }

    const body = await request.json();
    const data = validateInput(updateMyProfileSchema, body);

    const profile = await upsertRiderProfileByMember(ctx.clubId, ctx.memberId, data);
    if (!profile) {
      return errorResponse('UPDATE_FAILED', 'Could not save profile', 500);
    }

    void ctx.audit({
      action: 'rider_profile.self_update',
      resourceType: 'rider_profile',
      resourceId: profile.id,
    });

    return successResponse(profile);
  });
}
