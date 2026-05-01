import { type NextRequest } from 'next/server';
import {
  getClubById,
  updateClubSettings,
  getArenasByClub,
  getLessonTypesByClub,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/onboarding — Returns onboarding progress for the current club.
 */
export async function GET() {
  return withAuth(
    async (ctx) => {
      // Onboarding only needs existence + count. Page through the first
      // record only — the count query in each helper still returns the full
      // total regardless of pageSize, so this stays cheap.
      const [club, arenas, lessonTypes] = await Promise.all([
        getClubById(ctx.clubId),
        getArenasByClub(ctx.clubId, { page: 1, pageSize: 1 }),
        getLessonTypesByClub(ctx.clubId, { page: 1, pageSize: 1 }),
      ]);

      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      return successResponse({
        completed: !!club.onboardingCompletedAt,
        hasArenas: arenas.total > 0,
        hasLessonTypes: lessonTypes.total > 0,
        arenaCount: arenas.total,
        lessonTypeCount: lessonTypes.total,
      });
    },
    { requiredPermission: 'settings:read' },
  );
}

/**
 * POST /api/v1/onboarding — Marks onboarding as complete.
 */
export async function POST(_request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const club = await getClubById(ctx.clubId);
      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      if (club.onboardingCompletedAt) {
        return successResponse({ alreadyCompleted: true });
      }

      await updateClubSettings(ctx.clubId, {
        onboardingCompletedAt: new Date(),
      });

      logger.info('onboarding_completed', {
        clubId: ctx.clubId,
        completedBy: ctx.memberId,
      });

      void ctx.audit({
        action: 'club.onboarding_complete',
        resourceType: 'club',
        resourceId: ctx.clubId,
      });

      return successResponse({ completed: true });
    },
    { requiredPermission: 'settings:update' },
  );
}
