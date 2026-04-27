import { eq, and, desc, lt, sql, type SQL } from 'drizzle-orm';
import { db, rawDb } from '../index';
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

interface AuditLogFilters {
  actorMemberId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  page: number;
  pageSize: number;
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
 */
export async function createAuditEntry(params: CreateAuditEntryParams) {
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

  return entry;
}

export async function getAuditLog(clubId: string, filters: AuditLogFilters) {
  const conditions: SQL[] = [eq(auditLog.clubId, clubId)];

  if (filters.actorMemberId) {
    conditions.push(eq(auditLog.actorMemberId, filters.actorMemberId));
  }
  if (filters.action) {
    conditions.push(eq(auditLog.action, filters.action));
  }
  if (filters.resourceType) {
    conditions.push(eq(auditLog.resourceType, filters.resourceType));
  }
  if (filters.resourceId) {
    conditions.push(eq(auditLog.resourceId, filters.resourceId));
  }

  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db
      // ::int cast — Postgres returns count(*) as bigint which @neondatabase/
      // serverless surfaces as a string in the JSON output; the `<number>`
      // generic was lying. Mirrors every other count query in the codebase.
      // See audit F-16.
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(...conditions)),
  ]);

  return { data, total: Number(countResult[0]?.count ?? 0) };
}

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
  const result = await rawDb.execute(
    sql`DELETE FROM ${auditLog}
        WHERE ${auditLog.id} IN (
          SELECT ${auditLog.id} FROM ${auditLog}
          WHERE ${auditLog.createdAt} < ${cutoff}
          LIMIT ${limit}
        )`,
  );
  // pg returns a row-count style metadata; treat the truthy non-zero as
  // pruned for logging purposes. Drizzle's neon-http exposes `rowCount`
  // on the underlying object.
  return { cutoff: cutoff.toISOString(), pruned: (result as { rowCount?: number }).rowCount ?? 0 };
}

// Silence unused-import for `lt` — kept around so a future filtered
// archive (e.g. `getAuditLogBefore(...)`) doesn't need to re-add the
// import. Strip when that filter ships.
export type _AuditLogLtUnused = typeof lt;
