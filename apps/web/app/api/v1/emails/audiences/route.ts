import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createAudience,
  listAudiences,
  countAudienceMembersBatch,
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
      // One round-trip to compute every audience's member count, regardless
      // of how many audiences the club has. Replaces the previous
      // Promise.all(rows.map(countAudienceMembers)) — same shape, single query.
      const counts = await countAudienceMembersBatch(
        ctx.clubId,
        rows.map((a) => a.filters ?? {}),
      );
      const withCounts = rows.map((a, i) => ({
        ...a,
        memberCount: counts[i] ?? 0,
      }));
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
