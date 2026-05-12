import { type NextRequest } from 'next/server';
import { createCompetitionEntrySchema } from '@equestrian/shared/schemas';
import {
  getCompetitionClassById,
  getCompetitionEntries,
  createCompetitionEntry,
  isParentOf,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  parsePagination,
  paginatedListResponse,
  validateUuidParam,
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
      validateUuidParam('competitionId', competitionId);
      validateUuidParam('classId', classId);
      const mismatch = await assertClassBelongsToCompetition(ctx.clubId, competitionId, classId);
      if (mismatch) return mismatch;
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getCompetitionEntries(ctx.clubId, classId, {
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
      const { competitionId, classId } = await params;
      validateUuidParam('competitionId', competitionId);
      validateUuidParam('classId', classId);
      const mismatch = await assertClassBelongsToCompetition(ctx.clubId, competitionId, classId);
      if (mismatch) return mismatch;
      // Three valid registration paths, mirroring bookings/route.ts:
      //   - Staff with `competitions:create` (admin/manager via wildcard)
      //     may register any rider in the club.
      //   - Riders with `competitions:register` may register themselves.
      //   - Parents with `competitions:register_child` may register a
      //     rider linked to them via `rider_profiles.parent_member_id`.
      // Inline gate so the body validation + the role-aware narrowing
      // run together. The previous `requiredPermission: 'competitions:register'`
      // 403'd parents (their grant is `competitions:register_child`)
      // before the body even loaded — see audit F-1.
      const canRegisterAny = hasPermission(ctx.orgRole, 'competitions:create');
      const canRegisterSelf = hasPermission(ctx.orgRole, 'competitions:register');
      const canRegisterChild = hasPermission(ctx.orgRole, 'competitions:register_child');
      if (!canRegisterAny && !canRegisterSelf && !canRegisterChild) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to register competition entries',
          403,
        );
      }

      const data = await parseRequiredBody(request, createCompetitionEntrySchema);

      if (!ctx.memberId) {
        return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
      }

      const isSelf = data.riderMemberId === ctx.memberId;
      if (!isSelf) {
        if (!canRegisterAny && !canRegisterChild) {
          return errorResponse('FORBIDDEN', 'You can only register yourself for competitions', 403);
        }
        if (!canRegisterAny) {
          // Parent-only path — verify the target rider is recorded as
          // their dependent. Without this, the `register_child` grant
          // would let any parent register any rider in the club.
          // `createCompetitionEntry` separately rejects cross-tenant
          // riders via the RIDER_NOT_IN_CLUB error mapped below.
          const linked = await isParentOf(ctx.clubId, ctx.memberId, data.riderMemberId);
          if (!linked) {
            return errorResponse(
              'FORBIDDEN',
              'You can only register riders linked to you as a guardian',
              403,
            );
          }
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
              return errorResponse(
                'NOT_AVAILABLE',
                'Competition is not available for registration',
                422,
              );
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
    {
      // Permission gate is inline above — accepts any of staff
      // (`competitions:create`), self (`competitions:register`), or parent
      // (`competitions:register_child`), and narrows each role to the
      // riders they're allowed to register for. See audit F-1.
      //
      // Audit LOW (2026-05-05 pass 2): rate limit. Competition entries
      // are billable and a runaway client could fan out a dozen entries
      // per rider per cycle. Match the booking-creation cadence
      // (10/min/user, failClosed) since both are money-creating.
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'competition_entry_create',
    },
  );
}
