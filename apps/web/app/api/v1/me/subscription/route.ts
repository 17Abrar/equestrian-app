import {
  getClubById,
  getOutstandingPlatformInvoices,
  getPlatformInvoicesByClub,
} from '@equestrian/db/queries';
import { PLATFORM_TIER_PRICES_MINOR } from '@equestrian/shared/constants';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

/**
 * Returns the calling club's Cavaliq subscription summary: current
 * tier, status, trial end date, outstanding invoices (with pay links),
 * and a paged history. Only admins / managers see the panel — gated by
 * `settings:read` because subscription lives under Settings.
 */
export async function GET() {
  return withAuth(
    async (ctx) => {
      const club = await getClubById(ctx.clubId);
      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      const [outstanding, history] = await Promise.all([
        getOutstandingPlatformInvoices(ctx.clubId),
        getPlatformInvoicesByClub(ctx.clubId, 24),
      ]);

      return successResponse({
        tier: club.subscriptionTier,
        status: club.subscriptionStatus,
        trialEndsAt: club.trialEndsAt,
        // Snapshot of the current tier's monthly price so the dashboard
        // can show "next bill: AED 300 on YYYY-MM-DD" without each
        // tenant having to know about the constant.
        currentTierPriceMinor:
          PLATFORM_TIER_PRICES_MINOR[club.subscriptionTier],
        currency: club.currency,
        outstanding,
        history,
      });
    },
    { requiredPermission: 'settings:read' },
  );
}
