import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createAudience,
  listAudiences,
  countAudienceMembers,
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

const createAudienceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  filters: audienceFiltersSchema.default({}),
});

export async function GET() {
  return withAuth(
    async (ctx) => {
      const rows = await listAudiences(ctx.clubId);
      // Attach a live member count so the list page shows an accurate badge
      // without the UI making N+1 preview calls. Cheap because audiences are
      // few per club in practice.
      const withCounts = await Promise.all(
        rows.map(async (a) => ({
          ...a,
          memberCount: await countAudienceMembers(ctx.clubId, a.filters ?? {}),
        })),
      );
      return successResponse(withCounts);
    },
    { requiredPermission: 'emails:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createAudienceSchema, body);

      const audience = await createAudience(
        ctx.clubId,
        {
          name: data.name,
          description: data.description ?? null,
          filters: data.filters,
        },
        ctx.memberId,
      );

      if (!audience) {
        return errorResponse('CREATE_FAILED', 'Failed to create audience', 500);
      }

      void ctx.audit({
        action: 'audience.create',
        resourceType: 'audience',
        resourceId: audience.id,
      });

      return successResponse(audience, 201);
    },
    { requiredPermission: 'emails:create' },
  );
}
