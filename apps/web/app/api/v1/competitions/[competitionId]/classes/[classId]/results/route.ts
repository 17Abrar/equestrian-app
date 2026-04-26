import { type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { createCompetitionResultSchema } from '@equestrian/shared/schemas';
import {
  getCompetitionClassById,
  getCompetitionResults,
  createCompetitionResult,
} from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { competitionEntries } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId, classId } = await params;
      // Audit A-4: bind URL's classId to URL's competitionId.
      const cls = await getCompetitionClassById(ctx.clubId, classId);
      if (!cls || cls.competitionId !== competitionId) {
        return errorResponse('NOT_FOUND', 'Class does not belong to this competition', 404);
      }
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

      // Two judges submitting the same entry concurrently both pass the
      // entry-exists check above; the unique constraint
      // `competition_results_entry_unique` (migration 0018) makes the loser
      // see Postgres 23505. Map it to a clean 409 instead of falling through
      // to the catch-all 500 in withAuth.
      let result;
      try {
        result = await createCompetitionResult(ctx.clubId, data);
      } catch (err) {
        const pgCode = (err as { code?: string } | null)?.code;
        const msg = err instanceof Error ? err.message : '';
        if (pgCode === '23505' || msg.includes('competition_results_entry_unique')) {
          return errorResponse(
            'DUPLICATE_RESULT',
            'A result already exists for this entry',
            409,
          );
        }
        throw err;
      }

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
