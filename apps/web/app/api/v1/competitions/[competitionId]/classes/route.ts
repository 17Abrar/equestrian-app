import { type NextRequest } from 'next/server';
import { createCompetitionClassSchema } from '@equestrian/shared/schemas';
import { getCompetitionClasses, createCompetitionClass, getCompetitionById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
  parsePagination,
  paginatedListResponse,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      validateUuidParam('competitionId', competitionId);
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getCompetitionClasses(ctx.clubId, competitionId, {
        page,
        pageSize,
      });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      validateUuidParam('competitionId', competitionId);
      const data = await parseRequiredBody(request, createCompetitionClassSchema);

      // Verify competition exists and belongs to this club
      const competition = await getCompetitionById(ctx.clubId, competitionId);
      if (!competition) {
        return errorResponse('NOT_FOUND', 'Competition not found', 404);
      }

      const cls = await createCompetitionClass(ctx.clubId, {
        ...data,
        competitionId,
      });

      if (!cls) {
        return errorResponse('CREATE_FAILED', 'Failed to create class', 500);
      }

      void ctx.audit({
        action: 'competition_class.create',
        resourceType: 'competition_class',
        resourceId: cls.id,
        changes: {
          competitionId: { from: null, to: competitionId },
        },
      });

      return successResponse(cls, 201);
    },
    { requiredPermission: 'competitions:create' },
  );
}
