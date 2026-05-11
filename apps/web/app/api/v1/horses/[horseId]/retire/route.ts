import { type NextRequest } from 'next/server';
import { retireHorseOwnershipSchema } from '@equestrian/shared/schemas';
import { retireHorseOwnership, cancelPendingInvoicesForHorse } from '@equestrian/db/queries';
import { writeTransaction } from '@equestrian/db';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseOptionalBody,
  validateUuidParam,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Admin retires an active ownership. Billing stops from the retirement date
 * forward; operational `status` is left alone so the admin can independently
 * mark the horse sold / off-site / resting.
 *
 * Owner-initiated retirement lives at /api/v1/me/horses/[horseId]/retire.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const data = await parseOptionalBody(request, retireHorseOwnershipSchema);

      // Atomic: retire-ownership and cancel-pending-invoices commit together
      // or roll back together. Without this, a failure of the second write
      // left the horse marked retired while the cron kept billing —
      // see audit G-6.
      const result = await writeTransaction(async () => {
        const horse = await retireHorseOwnership(ctx.clubId, horseId, data.liveryEndDate);
        if (!horse) return null;
        const cancelled = await cancelPendingInvoicesForHorse(ctx.clubId, horseId);
        return { horse, cancelled };
      });

      if (!result) {
        return errorResponse('NOT_ACTIVE', 'Horse not found or is not an active ownership', 409);
      }

      void ctx.audit({
        action: 'horse.retire_ownership',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'active', to: 'retired' },
          liveryEndDate: { from: null, to: result.horse.liveryEndDate },
          invoicesCancelled: { from: null, to: result.cancelled },
        },
      });

      return successResponse(result.horse);
    },
    { requiredPermission: 'horses:update' },
  );
}
