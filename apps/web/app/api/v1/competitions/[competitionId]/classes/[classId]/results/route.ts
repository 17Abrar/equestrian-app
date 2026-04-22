import { type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { createCompetitionResultSchema } from '@equestrian/shared/schemas';
import { getCompetitionResults, createCompetitionResult } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { competitionEntries } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const results = await getCompetitionResults(ctx.clubId, classId);
      return successResponse(results);
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const body = await request.json();
      const data = validateInput(createCompetitionResultSchema, body);

      // Verify the entry belongs to the class in the URL
      const entry = await db
        .select({ id: competitionEntries.id })
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.id, data.entryId),
            eq(competitionEntries.classId, classId),
            eq(competitionEntries.clubId, ctx.clubId),
          ),
        )
        .limit(1);

      if (!entry[0]) {
        return errorResponse('INVALID_ENTRY', 'Entry does not belong to this class', 422);
      }

      const result = await createCompetitionResult(ctx.clubId, data);

      if (!result) {
        return errorResponse('CREATE_FAILED', 'Failed to create result', 500);
      }

      void ctx.audit({
        action: 'competition_result.create',
        resourceType: 'competition_result',
        resourceId: result.id,
        changes: {
          classId: { from: null, to: classId },
          entryId: { from: null, to: data.entryId },
        },
      });

      return successResponse(result, 201);
    },
    { requiredPermission: 'competitions:update' },
  );
}
