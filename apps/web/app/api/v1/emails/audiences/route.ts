import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { paginationSchema } from '@equestrian/shared/schemas';
import {
  createAudience,
  listAudiences,
  countAudienceMembersBatch,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
  paginatedResponse,
} from '@/lib/api-utils';

// audit M-1 (2026-05-05) — schema kept narrow: only the three filters the
// resolver actually evaluates. `.strict()` rejects unknown keys, so a
// caller that POSTs `hasActivePackage` or `tags` (the prior dead fields)
// now gets a 400, instead of silently persisting state the resolver
// would ignore.
const audienceFiltersSchema = z
  .object({
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    activeWithinDays: z.number().int().min(1).max(3650).optional(),
    minBookings: z.number().int().min(1).optional(),
  })
  .strict();

const createAudienceSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    filters: audienceFiltersSchema.default({}),
  })
  .strict();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const url = new URL(request.url);
      const { page, pageSize } = validateInput(paginationSchema, {
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await listAudiences(ctx.clubId, { page, pageSize });
      // One round-trip to compute every audience's member count for the
      // current page only — replaces the previous all-rows enrichment.
      const counts = await countAudienceMembersBatch(
        ctx.clubId,
        items.map((a) => a.filters ?? {}),
      );
      const withCounts = items.map((a, i) => ({
        ...a,
        memberCount: counts[i] ?? 0,
      }));
      return paginatedResponse(withCounts, { page, pageSize, total });
    },
    { requiredPermission: 'emails:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, createAudienceSchema);

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
