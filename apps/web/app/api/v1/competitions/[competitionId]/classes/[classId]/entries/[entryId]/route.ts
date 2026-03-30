import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { withdrawCompetitionEntry } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const withdrawSchema = z.object({
  reason: z.string().min(1, 'Withdrawal reason is required'),
});

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string; entryId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { entryId } = await params;
      const body = await request.json();
      const data = validateInput(withdrawSchema, body);

      const entry = await withdrawCompetitionEntry(ctx.clubId, entryId, data.reason);

      if (!entry) {
        return errorResponse('NOT_FOUND', 'Entry not found', 404);
      }

      logger.info('competition_entry_withdrawn', {
        entryId,
        clubId: ctx.clubId,
        reason: data.reason,
      });

      return successResponse(entry);
    },
    { requiredPermission: 'competitions:update' },
  );
}
