import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getAudienceById,
  updateAudience,
  deleteAudience,
  resolveAudienceMembers,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

const audienceFiltersSchema = z
  .object({
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    activeWithinDays: z.number().int().min(1).max(3650).optional(),
    hasActivePackage: z.boolean().optional(),
    minBookings: z.number().int().min(1).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const updateAudienceSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    filters: audienceFiltersSchema.optional(),
  })
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
      const audience = await getAudienceById(ctx.clubId, audienceId);
      if (!audience) {
        return errorResponse('NOT_FOUND', 'Audience not found', 404);
      }
      const members = await resolveAudienceMembers(ctx.clubId, audience.filters ?? {});
      return successResponse({
        ...audience,
        memberCount: members.length,
        members,
      });
    },
    { requiredPermission: 'emails:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { audienceId } = await params;
      const body = await request.json();
      const data = validateInput(updateAudienceSchema, body);

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
