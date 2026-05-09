import { type NextRequest } from 'next/server';
import { pruneAuditLog } from '@equestrian/db/queries';
import { errorResponse, requireCronSecret, successResponse } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * Audit pass-2 (2026-05-09 C-3): standalone cron route for audit-log
 * retention pruning.
 *
 * Previously co-located inside `/api/cron/livery-billing` so the
 * livery cron's daily fire was the de-facto audit-prune driver. That
 * coupling meant retention silently froze whenever:
 *   * the livery cron's outer try fired,
 *   * the cron secret was rotated only on Cloudflare and the route
 *     401'd, or
 *   * `worker-entry.mjs:KNOWN_CRON_TARGETS` mapped `0 2 * * *` away
 *     from livery-billing.
 *
 * Splitting to its own route + its own cron schedule means the only
 * way retention skips is its OWN cron tick failing, which surfaces
 * cleanly via `cron_scheduled_non_ok` and the route's own
 * structured-error log.
 *
 * Schedule: `30 3 * * *` — 03:30 UTC daily. Sequenced after horse-
 * care reminders (03:00) so each cron has its own 30s CPU budget,
 * and well before the next billing window so a slow prune can't
 * starve livery (02:00) the next day.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireCronSecret(request, 'audit_prune_cron');
  if (unauthorized) return unauthorized;

  logger.info('audit_prune_cron_started');

  try {
    const result = await pruneAuditLog();
    logger.info('audit_prune_cron_completed', { pruned: result.pruned });
    return successResponse({ pruned: result.pruned });
  } catch (err) {
    logger.error('audit_prune_cron_failed', {
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse(
      'INTERNAL_ERROR',
      'Audit prune failed. See structured logs.',
      500,
    );
  }
}
