import { type NextRequest } from 'next/server';
import { updateCompetitionClassSchema } from '@equestrian/shared/schemas';
import {
  getCompetitionClassById,
  updateCompetitionClass,
  deleteCompetitionClass,
  CompetitionClassHasEntriesError,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId, classId } = await params;
      validateUuidParam('competitionId', competitionId);
      validateUuidParam('classId', classId);
      const data = await parseRequiredBody(request, updateCompetitionClassSchema);

      // Bind the class to its competition. Without this an admin can mutate
      // any class in their club via any competitionId in the URL — fine for
      // tenant isolation but breaks the audit trail (the resourceId points
      // at the class with no competition context) and lets stale or forged
      // links flip the wrong row.
      const existing = await getCompetitionClassById(ctx.clubId, classId);
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }
      if (existing.competitionId !== competitionId) {
        return errorResponse('NOT_FOUND', 'Class does not belong to this competition', 404);
      }

      const cls = await updateCompetitionClass(ctx.clubId, classId, data);

      if (!cls) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }

      void ctx.audit({
        action: 'competition_class.update',
        resourceType: 'competition_class',
        resourceId: classId,
        changes: {
          competitionId: { from: null, to: competitionId },
        },
      });

      return successResponse(cls);
    },
    { requiredPermission: 'competitions:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId, classId } = await params;
      validateUuidParam('competitionId', competitionId);
      validateUuidParam('classId', classId);

      // See PATCH — bind the class to its competition before deletion.
      const existing = await getCompetitionClassById(ctx.clubId, classId);
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }
      if (existing.competitionId !== competitionId) {
        return errorResponse('NOT_FOUND', 'Class does not belong to this competition', 404);
      }

      let deleted: { id: string } | null;
      try {
        deleted = await deleteCompetitionClass(ctx.clubId, classId);
      } catch (err) {
        if (err instanceof CompetitionClassHasEntriesError) {
          return errorResponse(err.code, err.message, 409);
        }
        throw err;
      }

      if (!deleted) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }

      void ctx.audit({
        action: 'competition_class.delete',
        resourceType: 'competition_class',
        resourceId: classId,
        changes: {
          competitionId: { from: null, to: competitionId },
        },
      });

      return successResponse({ id: deleted.id });
    },
    { requiredPermission: 'competitions:delete' },
  );
}
