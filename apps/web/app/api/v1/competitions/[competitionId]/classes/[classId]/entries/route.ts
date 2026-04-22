import { type NextRequest } from 'next/server';
import { createCompetitionEntrySchema } from '@equestrian/shared/schemas';
import { getCompetitionEntries, createCompetitionEntry } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const entries = await getCompetitionEntries(ctx.clubId, classId);
      return successResponse(entries);
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const body = await request.json();
      const data = validateInput(createCompetitionEntrySchema, body);

      let entry;
      try {
        entry = await createCompetitionEntry(ctx.clubId, {
          ...data,
          classId,
        });
      } catch (err) {
        if (err instanceof Error) {
          switch (err.message) {
            case 'CLASS_NOT_FOUND':
              return errorResponse('NOT_FOUND', 'Competition class not found', 404);
            case 'COMPETITION_NOT_AVAILABLE':
              return errorResponse('NOT_AVAILABLE', 'Competition is not available for registration', 422);
            case 'REGISTRATION_DEADLINE_PASSED':
              return errorResponse('DEADLINE_PASSED', 'Registration deadline has passed', 422);
            case 'CLASS_FULL':
              return errorResponse('CLASS_FULL', 'This class has reached maximum entries', 409);
          }
        }
        throw err;
      }

      if (!entry) {
        return errorResponse('CREATE_FAILED', 'Failed to create entry', 500);
      }

      logger.info('competition_entry_created', {
        entryId: entry.id,
        classId,
        clubId: ctx.clubId,
        riderId: data.riderMemberId,
      });

      void ctx.audit({
        action: 'competition_entry.create',
        resourceType: 'competition_entry',
        resourceId: entry.id,
        changes: {
          classId: { from: null, to: classId },
          riderMemberId: { from: null, to: data.riderMemberId },
        },
      });

      return successResponse(entry, 201);
    },
    { requiredPermission: 'competitions:register' },
  );
}
