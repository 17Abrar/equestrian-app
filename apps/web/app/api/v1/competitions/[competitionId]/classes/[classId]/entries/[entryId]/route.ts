import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getCompetitionEntryById,
  withdrawCompetitionEntry,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

const withdrawSchema = z.object({
  reason: z.string().min(1, 'Withdrawal reason is required'),
});

interface RouteParams {
  params: Promise<{ competitionId: string; classId: string; entryId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { entryId } = await params;
    const body = await request.json();
    const data = validateInput(withdrawSchema, body);

    // Staff with `competitions:update` (admin/manager via wildcard) can
    // withdraw any entry. Riders/parents with `competitions:register` can
    // only withdraw their own — symmetric with the POST endpoint, which
    // also lets them register themselves but not others. Inline check
    // rather than `requiredPermission` so the own-entry constraint runs
    // after we've loaded the row.
    const canWithdrawAny = hasPermission(ctx.orgRole, 'competitions:update');
    const canWithdrawOwn = hasPermission(ctx.orgRole, 'competitions:register');

    if (!canWithdrawAny && !canWithdrawOwn) {
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
      if (existing.riderMemberId !== ctx.memberId) {
        return errorResponse(
          'FORBIDDEN',
          'You can only withdraw your own entries',
          403,
        );
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

    void ctx.audit({
      action: 'competition_entry.withdraw',
      resourceType: 'competition_entry',
      resourceId: entryId,
      changes: { reason: { from: null, to: data.reason } },
    });

    return successResponse(entry);
  });
}
