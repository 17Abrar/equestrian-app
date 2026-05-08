import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { countAudienceMembers } from '@equestrian/db/queries';
import { withAuth, successResponse, parseRequiredBody } from '@/lib/api-utils';

// audit M-1 (2026-05-05) — preview must match POST/PATCH so the count
// the user sees while building a filter is the same count the resolver
// would deliver. Diverging schemas would re-introduce the original bug.
// Audit F-7 (2026-05-06 r2): outer `.strict()`. The inner `filters`
// was already strict but a request body of `{ filters: {...},
// clubId: '<other>' }` parsed cleanly because the outer object
// silently dropped the extra key. Mass-assignment hardening — every
// other input schema in the codebase strict()s the outer.
const previewSchema = z
  .object({
    filters: z
      .object({
        skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
        activeWithinDays: z.number().int().min(1).max(3650).optional(),
        minBookings: z.number().int().min(1).optional(),
      })
      .strict(),
  })
  .strict();

// POST returns the match count for an ad-hoc filter set without persisting an
// audience. Used by the audience builder to show live feedback as the user
// toggles filters.
export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { filters } = await parseRequiredBody(request, previewSchema);
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
