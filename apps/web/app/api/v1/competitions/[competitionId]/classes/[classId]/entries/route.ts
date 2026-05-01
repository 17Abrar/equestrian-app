import { type NextRequest } from 'next/server';
import { createCompetitionEntrySchema, paginationSchema } from '@equestrian/shared/schemas';
import {
  getCompetitionClassById,
  getCompetitionEntries,
  createCompetitionEntry,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  paginatedResponse,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string }>;
}

/**
 * Asserts that the URL's `classId` actually belongs to the URL's
 * `competitionId` (audit A-4). The sibling routes
 * `classes/[classId]/route.ts` and `classes/[classId]/results/route.ts`
 * already enforce this binding; the entries route was inconsistent.
 *
 * Returns null on success, or a 404 NextResponse on mismatch.
 */
async function assertClassBelongsToCompetition(
  clubId: string,
  competitionId: string,
  classId: string,
) {
  const cls = await getCompetitionClassById(clubId, classId);
  if (!cls || cls.competitionId !== competitionId) {
    return errorResponse('NOT_FOUND', 'Class does not belong to this competition', 404);
  }
  return null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId, classId } = await params;
      const mismatch = await assertClassBelongsToCompetition(ctx.clubId, competitionId, classId);
      if (mismatch) return mismatch;
      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getCompetitionEntries(ctx.clubId, classId, {
        page,
        pageSize,
      });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'competitions:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { competitionId, classId } = await params;
      const mismatch = await assertClassBelongsToCompetition(ctx.clubId, competitionId, classId);
      if (mismatch) return mismatch;
      const body = await request.json();
      const data = validateInput(createCompetitionEntrySchema, body);

      // Riders/parents may only register themselves; only staff with
      // `competitions:create` (admin/manager via wildcard) may register
      // another rider. Without this, any caller with the `competitions:register`
      // grant could submit an arbitrary `riderMemberId` and enroll someone
      // else. Mirrors the bookings/route.ts:99-113 pattern.
      const canRegisterOthers = hasPermission(ctx.orgRole, 'competitions:create');
      if (!canRegisterOthers) {
        if (!ctx.memberId) {
          return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
        }
        if (data.riderMemberId !== ctx.memberId) {
          return errorResponse('FORBIDDEN', 'You can only register yourself for competitions', 403);
        }
      }

      let entry;
      try {
        entry = await createCompetitionEntry(ctx.clubId, {
          ...data,
          classId,
        });
      } catch (err) {
        if (err instanceof Error) {
          switch (err.message) {
            case 'CLASS_NOT_FOUND':
              return errorResponse('NOT_FOUND', 'Competition class not found', 404);
            case 'RIDER_NOT_IN_CLUB':
              return errorResponse('INVALID_RIDER', 'Rider is not a member of this club', 400);
            case 'HORSE_NOT_FOUND':
              return errorResponse('INVALID_HORSE', 'Horse not found', 404);
            case 'HORSE_NOT_AVAILABLE_FOR_RIDER':
              return errorResponse(
                'HORSE_NOT_AVAILABLE',
                'This horse is not available for the selected rider',
                422,
              );
            case 'COMPETITION_NOT_AVAILABLE':
              return errorResponse('NOT_AVAILABLE', 'Competition is not available for registration', 422);
            case 'REGISTRATION_DEADLINE_PASSED':
              return errorResponse('DEADLINE_PASSED', 'Registration deadline has passed', 422);
            case 'CLASS_FULL':
              return errorResponse('CLASS_FULL', 'This class has reached maximum entries', 409);
          }
        }
        throw err;
      }

      if (!entry) {
        return errorResponse('CREATE_FAILED', 'Failed to create entry', 500);
      }

      logger.info('competition_entry_created', {
        entryId: entry.id,
        classId,
        clubId: ctx.clubId,
        riderId: data.riderMemberId,
      });

      void ctx.audit({
        action: 'competition_entry.create',
        resourceType: 'competition_entry',
        resourceId: entry.id,
        changes: {
          classId: { from: null, to: classId },
          riderMemberId: { from: null, to: data.riderMemberId },
        },
      });

      return successResponse(entry, 201);
    },
    { requiredPermission: 'competitions:register' },
  );
}
