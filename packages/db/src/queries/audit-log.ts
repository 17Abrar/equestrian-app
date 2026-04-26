import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
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
