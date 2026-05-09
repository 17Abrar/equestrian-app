import { type NextRequest } from 'next/server';
import { updateCompetitionSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import {
  getCompetitionById,
  updateCompetition,
  deleteCompetition,
  getArenaById,
  getClubTimezone,
} from '@equestrian/db/queries';
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

      // Audit follow-up (2026-05-08): refuse soft-deleted arenas — same
      // rationale as the POST sibling. Composite FK only catches
      // cross-tenant; an in-club deactivated arena still satisfies it.
      if (data.arenaId) {
        const arena = await getArenaById(ctx.clubId, data.arenaId, {
          activeOnly: true,
        });
        if (!arena) {
          return errorResponse(
            'INVALID_ARENA',
            'Arena not found, or has been deactivated.',
            400,
          );
        }
      }

      // Convert registrationDeadline from datetime-local to UTC using club
      // timezone. Detect by exact datetime-local regex (YYYY-MM-DDTHH:MM
      // optionally with seconds) — the previous heuristic checked for
      // absence of `Z`/`+` and tripped over legitimate ISO strings with a
      // negative offset like `2026-05-15T10:00:00-04:00`. See audit G-15.
      const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
      let registrationDeadline = data.registrationDeadline;
      if (registrationDeadline && DATETIME_LOCAL_RE.test(registrationDeadline)) {
        // Audit pass-3 (2026-05-09): soft-delete-gated helper.
        const timezone = (await getClubTimezone(ctx.clubId)) ?? 'Asia/Dubai';
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
