import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { countAudienceMembers } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

// audit M-1 (2026-05-05) — preview must match POST/PATCH so the count
// the user sees while building a filter is the same count the resolver
// would deliver. Diverging schemas would re-introduce the original bug.
const previewSchema = z.object({
  filters: z
    .object({
      skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
      activeWithinDays: z.number().int().min(1).max(3650).optional(),
      minBookings: z.number().int().min(1).optional(),
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
      // Audit E-2: failClosed so a Redis outage doesn't let an attacker
      // enumerate audience-shape data via 60+ rapid requests.
      rateLimit: { maxRequests: 60, windowMs: 60_000, failClosed: true },
      routeKey: 'emails:audiences:preview',
    },
  );
}
