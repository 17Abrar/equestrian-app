import { type NextRequest } from 'next/server';
import { createCompetitionClassSchema } from '@equestrian/shared/schemas';
import { getCompetitionClasses, createCompetitionClass, getCompetitionById } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      const classes = await getCompetitionClasses(ctx.clubId, competitionId);
      return successResponse(classes);
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      const body = await request.json();
      const data = validateInput(createCompetitionClassSchema, body);

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

      return successResponse(cls, 201);
    },
    { requiredPermission: 'competitions:create' },
  );
}
