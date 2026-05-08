import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { createCompetitionSchema, competitionFiltersSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { getCompetitionsByClub, createCompetition } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(competitionFiltersSchema, searchParams);

      const { data, total } = await getCompetitionsByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, createCompetitionSchema);

      // Convert registrationDeadline from datetime-local (no TZ) to UTC using club timezone
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

      const competition = await createCompetition(ctx.clubId, {
        ...data,
        registrationDeadline,
      });

      if (!competition) {
        return errorResponse('CREATE_FAILED', 'Failed to create competition', 500);
      }

      logger.info('competition_created', {
        competitionId: competition.id,
        clubId: ctx.clubId,
        name: data.name,
      });

      void ctx.audit({
        action: 'competition.create',
        resourceType: 'competition',
        resourceId: competition.id,
      });

      return successResponse(competition, 201);
    },
    { requiredPermission: 'competitions:create' },
  );
}
