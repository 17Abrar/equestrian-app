import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { countAudienceMembers } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

const previewSchema = z.object({
  filters: z
    .object({
      skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
      activeWithinDays: z.number().int().min(1).max(3650).optional(),
      hasActivePackage: z.boolean().optional(),
      minBookings: z.number().int().min(1).optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict(),
});

// POST returns the match count for an ad-hoc filter set without persisting an
// audience. Used by the audience builder to show live feedback as the user
// toggles filters.
export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const { filters } = validateInput(previewSchema, body);
      const count = await countAudienceMembers(ctx.clubId, filters);
      return successResponse({ count });
    },
    {
      requiredPermission: 'emails:read',
      rateLimit: { maxRequests: 60, windowMs: 60_000 },
      routeKey: 'emails:audiences:preview',
    },
  );
}
