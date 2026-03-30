import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { updateCompetitionSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { getCompetitionById, updateCompetition, deleteCompetition } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ competitionId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
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
      const body = await request.json();
      const data = validateInput(updateCompetitionSchema, body);

      // Convert registrationDeadline from datetime-local to UTC using club timezone
      let registrationDeadline = data.registrationDeadline;
      if (registrationDeadline && !registrationDeadline.includes('Z') && !registrationDeadline.includes('+')) {
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

      return successResponse(competition);
    },
    { requiredPermission: 'competitions:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId } = await params;
      const deleted = await deleteCompetition(ctx.clubId, competitionId);

      if (!deleted) {
        return errorResponse('NOT_FOUND', 'Competition not found', 404);
      }

      return successResponse({ id: deleted.id, message: 'Competition archived' });
    },
    { requiredPermission: 'competitions:delete' },
  );
}
