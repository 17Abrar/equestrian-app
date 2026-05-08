import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getCompetitionClassById,
  getCompetitionEntryById,
  isParentOf,
  withdrawCompetitionEntry,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

// Audit F-18 (2026-05-07 r4): cap the reason at 500 chars. The freeform
// text lands on the entry row itself; the parallel audit_log carve-out
// (see below) drops the value from `changes` so a typed-out personal
// phone or email doesn't sit in the 90-day-retained log alongside.
const withdrawSchema = z
  .object({
    reason: z.string().min(1, 'Withdrawal reason is required').max(500),
  })
  .strict();

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string; entryId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { competitionId, classId, entryId } = await params;
    validateUuidParam('competitionId', competitionId);
    validateUuidParam('classId', classId);
    validateUuidParam('entryId', entryId);
    // Audit A-4: bind URL's classId to URL's competitionId so a stale link
    // (`/competitions/X/classes/Y/...` where X is not Y's parent) returns
    // 404 instead of silently mutating an entry under the wrong audit
    // breadcrumb.
    const cls = await getCompetitionClassById(ctx.clubId, classId);
    if (!cls || cls.competitionId !== competitionId) {
      return errorResponse('NOT_FOUND', 'Class does not belong to this competition', 404);
    }
    const data = await parseRequiredBody(request, withdrawSchema);

    // Three valid withdraw paths, symmetric with the POST endpoint:
    //   - Staff with `competitions:update` (admin/manager via wildcard)
    //     may withdraw any entry.
    //   - Riders with `competitions:register` may withdraw their own.
    //   - Parents with `competitions:register_child` may withdraw their
    //     dependent's entry, verified via `rider_profiles.parent_member_id`.
    // The own-entry constraint runs after the row is loaded so we can
    // also check guardian status for the parent path. See audit F-2.
    const canWithdrawAny = hasPermission(ctx.orgRole, 'competitions:update');
    const canWithdrawSelf = hasPermission(ctx.orgRole, 'competitions:register');
    const canWithdrawChild = hasPermission(ctx.orgRole, 'competitions:register_child');

    if (!canWithdrawAny && !canWithdrawSelf && !canWithdrawChild) {
      return errorResponse(
        'FORBIDDEN',
        'You do not have permission to withdraw competition entries',
        403,
      );
    }

    const existing = await getCompetitionEntryById(ctx.clubId, entryId);
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Entry not found', 404);
    }

    if (existing.status === 'withdrawn') {
      return errorResponse('ALREADY_WITHDRAWN', 'Entry is already withdrawn', 422);
    }

    if (!canWithdrawAny) {
      if (!ctx.memberId) {
        return errorResponse(
          'NO_MEMBER',
          'Your user account is not linked to a club member',
          400,
        );
      }
      const isSelf = existing.riderMemberId === ctx.memberId;
      if (!isSelf) {
        if (!canWithdrawChild) {
          return errorResponse(
            'FORBIDDEN',
            'You can only withdraw your own entries',
            403,
          );
        }
        const linked = await isParentOf(ctx.clubId, ctx.memberId, existing.riderMemberId);
        if (!linked) {
          return errorResponse(
            'FORBIDDEN',
            'You can only withdraw entries for riders linked to you as a guardian',
            403,
          );
        }
      }
    }

    const entry = await withdrawCompetitionEntry(ctx.clubId, entryId, data.reason);

    if (!entry) {
      return errorResponse('NOT_FOUND', 'Entry not found', 404);
    }

    logger.info('competition_entry_withdrawn', {
      entryId,
      clubId: ctx.clubId,
      reason: data.reason,
    });

    // Audit F-18 (2026-05-07 r4): drop the freeform `reason` from
    // audit_log.changes — it lives on the entry row already and the
    // action + resourceId prove the withdraw happened. Avoids
    // 90-day-retention of a parent's typed-out personal email/phone.
    void ctx.audit({
      action: 'competition_entry.withdraw',
      resourceType: 'competition_entry',
      resourceId: entryId,
    });

    return successResponse(entry);
  });
}
