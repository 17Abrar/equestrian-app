import { sql } from 'drizzle-orm';
import { rawDb, writeTransaction } from '../index';
import { auditLog } from '../schema/operations';

export interface CreateAuditEntryParams {
  clubId: string;
  actorMemberId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
  userAgent?: string;
}

const IP_PATTERN = /^[\da-f.:]+$/i;
const MAX_USER_AGENT_LENGTH = 2048;

function sanitizeIp(ip: string | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  return IP_PATTERN.test(ip) ? ip : null;
}

/**
 * Writes an audit entry using the HTTP driver on a separate connection —
 * intentionally bypassing any active tenant transaction. Callers use
 * fire-and-forget (`void ctx.audit(...)`), so the insert must not race the
 * outer transaction's commit, and audits must persist even if the main
 * operation rolls back.
 *
 * Audit M-2: wrapped in try/catch so a transient DB blip during a
 * fire-and-forget audit doesn't surface as an unhandledRejection. The
 * caller's mutation has already committed by the time we run; if the
 * audit row can't land we log loudly so observability picks up the
 * gap.
 */
export async function createAuditEntry(
  params: CreateAuditEntryParams,
): Promise<{ id: string } | null> {
  try {
    const [entry] = await rawDb
      .insert(auditLog)
      .values({
        clubId: params.clubId,
        actorMemberId: params.actorMemberId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        changes: params.changes,
        ipAddress: sanitizeIp(params.ipAddress),
        userAgent: params.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      })
      .returning({ id: auditLog.id });

    return entry ?? null;
  } catch (err) {
    // Avoid pulling in the app-side logger here (different package; would
    // create a circular import). console.error is the audit-trail-of-
    // last-resort signal — operators monitor this prefix in tail logs.
    // eslint-disable-next-line no-console
    console.error('[audit] createAuditEntry failed', {
      clubId: params.clubId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

// Audit F-63 (2026-05-07 r4): `getAuditLog` was a dead export — staged
// for an admin audit-log viewer that hasn't shipped. Deleted to reduce
// unmaintained surface area; restore (with row-level role check) when
// the viewer route lands. The `pruneAuditLog` retention path stays.

/**
 * Daily-cron retention prune for audit_log. Audit F-9 — every withAuth
 * route writes one row, so absent retention the table grows linearly
 * forever (~10MB/club/year at moderate use, ~12GB after a few years
 * across 50 clubs). Rows older than `retentionDays` are dropped; default
 * 90 days matches the webhook_events prune cadence and the typical
 * support-investigation window.
 *
 * Uses a single bounded DELETE keyed on the indexed `createdAt` column;
 * cron runs already cap at 5min wallclock so the bound stops a one-shot
 * 100GB delete from killing the worker. Repeat runs catch up.
 */
export async function pruneAuditLog(retentionDays = 90, limit = 5000) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  // Audit LOW-5 (2026-05-05): bound the DELETE at the DB level. The cron's
  // 5min wallclock cap is the only brake today — a runaway prune (severe
  // bloat after ~2yr without a sweep, or a table-locked vacuum) could
  // consume the worker's entire budget and skip the rest of the cron.
  // `SET LOCAL` requires a transaction, so we route through writeTransaction.
  return writeTransaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '4min'`);
    const result = await tx.execute(
      sql`DELETE FROM ${auditLog}
          WHERE ${auditLog.id} IN (
            SELECT ${auditLog.id} FROM ${auditLog}
            WHERE ${auditLog.createdAt} < ${cutoff}
            LIMIT ${limit}
          )`,
    );
    return {
      cutoff: cutoff.toISOString(),
      pruned: (result as { rowCount?: number }).rowCount ?? 0,
    };
  });
}

