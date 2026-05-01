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
      return errorResponse('NO_MEMBER', 'Member profile not found', 404);
    }

    const rider = await getRiderByMemberId(ctx.clubId, ctx.memberId);
    return successResponse(rider);
  });
}

// Fields a rider is allowed to edit on their own profile. Skill level is
// present — admins will often override it from the staff side, but the
// rider's self-reported level is a sensible default.
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
