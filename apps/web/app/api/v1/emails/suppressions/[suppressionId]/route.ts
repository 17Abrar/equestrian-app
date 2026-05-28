import { type NextRequest } from 'next/server';
import { retireManualSuppressionForClub } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ suppressionId: string }>;
}

/**
 * Task #21 (2026-05-28): retire a manual suppression. Scoped to
 * (club_id = ctx.clubId, source = 'manual') so a tampered request
 * can't retire another club's row or a global webhook entry.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { suppressionId } = await params;
      validateUuidParam('suppressionId', suppressionId);

      const ok = await retireManualSuppressionForClub(ctx.clubId, suppressionId);
      if (!ok) {
        // Either the id doesn't exist, belongs to another club, or
        // wasn't a manual entry. Return 404 — same shape for all
        // three so probing tells the caller nothing extra.
        return errorResponse('NOT_FOUND', 'Suppression not found', 404);
      }

      void ctx.audit({
        action: 'email.suppression_retire',
        resourceType: 'email_suppression',
        resourceId: suppressionId,
        changes: {
          retiredAt: { from: null, to: 'now' },
        },
      });

      return successResponse({ id: suppressionId, retired: true });
    },
    { requiredPermission: 'emails:create' },
  );
}
