import { type NextRequest } from 'next/server';
import { updateCompetitionClassSchema } from '@equestrian/shared/schemas';
import { updateCompetitionClass, deleteCompetitionClass } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const body = await request.json();
      const data = validateInput(updateCompetitionClassSchema, body);

      const cls = await updateCompetitionClass(ctx.clubId, classId, data);

      if (!cls) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }

      return successResponse(cls);
    },
    { requiredPermission: 'competitions:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { classId } = await params;
      const deleted = await deleteCompetitionClass(ctx.clubId, classId);

      if (!deleted) {
        return errorResponse('NOT_FOUND', 'Class not found', 404);
      }

      return successResponse({ id: deleted.id });
    },
    { requiredPermission: 'competitions:delete' },
  );
}
