import { type NextRequest } from 'next/server';
import { retireHorseOwnershipSchema } from '@equestrian/shared/schemas';
import {
  retireHorseOwnership,
  getHorseOwnershipByUser,
  createAuditEntry,
  cancelPendingInvoicesForHorse,
} from '@equestrian/db/queries';
import { writeTransaction } from '@equestrian/db';
import { withAuth, successResponse, errorResponse, parseOptionalBody } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Owner-initiated retirement. Separate from the admin endpoint because the
 * auth story is different: the owner's active tenant club may not be the
 * horse's club, so we can't rely on `ctx.clubId` for the scoping WHERE.
 * Instead, we verify ownership via Clerk user ID, then pass the horse's own
 * clubId into the mutation.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const data = await parseOptionalBody(request, retireHorseOwnershipSchema);

      const ownership = await getHorseOwnershipByUser(ctx.userId, horseId);
      if (!ownership) {
        return errorResponse('FORBIDDEN', 'You are not the owner of this horse', 403);
      }

      if (ownership.ownershipStatus !== 'active') {
        return errorResponse(
          'NOT_ACTIVE',
          'Only active ownerships can be retired',
          409,
        );
      }

      // Atomic retire + cancel-invoices — see audit G-6. Without the
      // transaction, a DB blip between the two writes left the horse
      // retired but the cron still firing reminders for invoices the
      // owner cannot settle.
      const result = await writeTransaction(async () => {
        const retired = await retireHorseOwnership(
          ownership.clubId,
          horseId,
          data.liveryEndDate,
        );
        if (!retired) return null;
        const cancelled = await cancelPendingInvoicesForHorse(ownership.clubId, horseId);
        return { horse: retired, cancelled };
      });

      if (!result) {
        // Race where admin retires simultaneously with the owner's request.
        return errorResponse('NOT_ACTIVE', 'Unable to retire horse', 409);
      }

      void createAuditEntry({
        clubId: ownership.clubId,
        actorMemberId: ctx.memberId,
        action: 'horse.retire_ownership_self',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'active', to: 'retired' },
          liveryEndDate: { from: null, to: result.horse.liveryEndDate },
          invoicesCancelled: { from: null, to: result.cancelled },
        },
      }).catch((err) => {
        logger.error('audit_log_failed', {
          clubId: ownership.clubId,
          action: 'horse.retire_ownership_self',
          resourceId: horseId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return successResponse(result.horse);
    },
    // Layered defence: the in-handler ownership check (`getHorseOwnershipByUser`)
    // is still the authoritative gate, but adding a permission requirement
    // matches the convention used by every other route in the codebase and
    // catches the case where a future change to the ownership resolver
    // accidentally relaxes the gate. Both `horse_owner` and `rider` carry
    // `horses:update_own`, which covers everyone who can own a horse.
    { requiredPermission: 'horses:update_own' },
  );
}
