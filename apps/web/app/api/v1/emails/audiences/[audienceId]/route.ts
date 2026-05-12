import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getAudienceById,
  updateAudience,
  deleteAudience,
  resolveAudienceMembers,
  countAudienceMembers,
  MEMBERS_PREVIEW_CAP,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

// audit M-1 (2026-05-05) — see the matching schema in
// `app/api/v1/emails/audiences/route.ts` for rationale. The two
// validators must stay in lockstep: a key that POST accepts but PATCH
// rejects (or vice versa) is its own latent bug.
const audienceFiltersSchema = z
  .object({
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    activeWithinDays: z.number().int().min(1).max(3650).optional(),
    minBookings: z.number().int().min(1).optional(),
  })
  .strict();

// Audit F-10 (2026-05-07 r4): same hazard as F-9 — `.strict()` BEFORE
// `.refine()` so unknown keys 422. The sibling POST schema in
// `audiences/route.ts` is already `.strict()`; this one drifted.
// `audiences.created_by_member_id` is a real column an attacker could
// otherwise try to overwrite.
const updateAudienceSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    filters: audienceFiltersSchema.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

interface RouteParams {
  params: Promise<{ audienceId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { audienceId } = await params;
      validateUuidParam('audienceId', audienceId);
      const audience = await getAudienceById(ctx.clubId, audienceId);
      if (!audience) {
        return errorResponse('NOT_FOUND', 'Audience not found', 404);
      }
      // Audit r5 F-1 (2026-05-07): cap the projection at MEMBERS_PREVIEW_CAP
      // and surface the SQL-side total separately. Previously this returned
      // the full active rider roster on every detail GET — for a 10k-club,
      // hundreds of KB and an unbounded scan per request.
      const filters = audience.filters ?? {};
      const [members, memberCount] = await Promise.all([
        resolveAudienceMembers(ctx.clubId, filters, { limit: MEMBERS_PREVIEW_CAP }),
        countAudienceMembers(ctx.clubId, filters),
      ]);
      return successResponse({
        ...audience,
        memberCount,
        members,
        memberPreviewCap: MEMBERS_PREVIEW_CAP,
        memberPreviewTruncated: memberCount > members.length,
      });
    },
    { requiredPermission: 'emails:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { audienceId } = await params;
      validateUuidParam('audienceId', audienceId);
      const data = await parseRequiredBody(request, updateAudienceSchema);

      const audience = await updateAudience(ctx.clubId, audienceId, data);
      if (!audience) {
        return errorResponse('NOT_FOUND', 'Audience not found', 404);
      }

      void ctx.audit({
        action: 'audience.update',
        resourceType: 'audience',
        resourceId: audienceId,
      });

      return successResponse(audience);
    },
    { requiredPermission: 'emails:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { audienceId } = await params;
      validateUuidParam('audienceId', audienceId);
      const result = await deleteAudience(ctx.clubId, audienceId);
      if (!result) {
        return errorResponse('NOT_FOUND', 'Audience not found', 404);
      }

      void ctx.audit({
        action: 'audience.delete',
        resourceType: 'audience',
        resourceId: audienceId,
      });

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'emails:delete' },
  );
}
