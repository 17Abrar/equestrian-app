import { type NextRequest } from 'next/server';
import { retireHorseOwnershipSchema } from '@equestrian/shared/schemas';
import { retireHorseOwnership, cancelPendingInvoicesForHorse } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseOptionalBody } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

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
      const data = await parseOptionalBody(request, retireHorseOwnershipSchema);

      const horse = await retireHorseOwnership(ctx.clubId, horseId, data.liveryEndDate);

      if (!horse) {
        return errorResponse(
          'NOT_ACTIVE',
          'Horse not found or is not an active ownership',
          409,
        );
      }

      // Cancel any invoices the cron would otherwise keep chasing.
      // Non-fatal — if this fails, the retire itself still succeeds and
      // the admin can manually cancel lingering invoices from the livery tab.
      // Log the error so a sustained DB problem is visible in Sentry rather
      // than silently leaving phantom invoices for the cron to bill.
      const cancelled = await cancelPendingInvoicesForHorse(ctx.clubId, horseId)
        .catch((err) => {
          logger.error('cancel_pending_invoices_failed', {
            clubId: ctx.clubId,
            horseId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          return 0;
        });

      void ctx.audit({
        action: 'horse.retire_ownership',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'active', to: 'retired' },
          liveryEndDate: { from: null, to: horse.liveryEndDate },
          invoicesCancelled: { from: null, to: cancelled },
        },
      });

      return successResponse(horse);
    },
    { requiredPermission: 'horses:update' },
  );
}
