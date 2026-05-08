import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { updateCompetitionSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { getCompetitionById, updateCompetition, deleteCompetition } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, parseRequiredBody, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      validateUuidParam('competitionId', competitionId);
      const competition = await getCompetitionById(ctx.clubId, competitionId);

      if (!competition) {
        return errorResponse('NOT_FOUND', 'Competition not found', 404);
      }

      return successResponse(competition);
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      validateUuidParam('competitionId', competitionId);
      const data = await parseRequiredBody(request, updateCompetitionSchema);

      // Convert registrationDeadline from datetime-local to UTC using club
      // timezone. Detect by exact datetime-local regex (YYYY-MM-DDTHH:MM
      // optionally with seconds) — the previous heuristic checked for
      // absence of `Z`/`+` and tripped over legitimate ISO strings with a
      // negative offset like `2026-05-15T10:00:00-04:00`. See audit G-15.
      const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
      let registrationDeadline = data.registrationDeadline;
      if (registrationDeadline && DATETIME_LOCAL_RE.test(registrationDeadline)) {
        const clubRow = await db
          .select({ timezone: clubs.timezone })
          .from(clubs)
          .where(eq(clubs.id, ctx.clubId))
          .limit(1);

        const timezone = clubRow[0]?.timezone ?? 'Asia/Dubai';
        registrationDeadline = parseDateTimeLocal(registrationDeadline, timezone).toISOString();
      }

      const competition = await updateCompetition(ctx.clubId, competitionId, {
        ...data,
        ...(registrationDeadline !== undefined ? { registrationDeadline } : {}),
      });

      if (!competition) {
        return errorResponse('NOT_FOUND', 'Competition not found', 404);
      }

      void ctx.audit({
        action: 'competition.update',
        resourceType: 'competition',
        resourceId: competitionId,
      });

      return successResponse(competition);
    },
    { requiredPermission: 'competitions:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      validateUuidParam('competitionId', competitionId);
      const deleted = await deleteCompetition(ctx.clubId, competitionId);

      if (!deleted) {
        return errorResponse('NOT_FOUND', 'Competition not found', 404);
      }

      void ctx.audit({
        action: 'competition.delete',
        resourceType: 'competition',
        resourceId: competitionId,
      });

      return successResponse({ id: deleted.id, message: 'Competition archived' });
    },
    { requiredPermission: 'competitions:delete' },
  );
}
