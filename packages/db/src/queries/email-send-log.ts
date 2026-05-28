import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../index';
import { emailSendLog, type EmailSendSource, type EmailSendStatus } from '../schema/email-send-log';
import { audiences } from '../schema/audiences';
import { clubMembers } from '../schema/club-members';

/**
 * Task #22 (2026-05-28): persistent send log for the in-app "Recently
 * sent" tab. Writes happen on the email lib side (post-Resend); reads
 * power the listing UI.
 */

interface RecordSendArgs {
  clubId: string;
  senderMemberId?: string | null;
  toEmail: string;
  subject: string;
  audienceId?: string | null;
  trigger?: string | null;
  source: EmailSendSource;
  status: EmailSendStatus;
  resendId?: string | null;
  error?: string | null;
}

/**
 * Inserts one row of send history. Returns the new row's id so the
 * caller can UPDATE it after the Resend response resolves (queued →
 * sent / failed / suppressed).
 *
 * Errors during insert are NOT rethrown — the log row is a nice-to-
 * have; failing to log MUST NOT block the email send.
 */
export async function recordEmailSend(args: RecordSendArgs): Promise<string | null> {
  try {
    const rows = await db
      .insert(emailSendLog)
      .values({
        clubId: args.clubId,
        senderMemberId: args.senderMemberId ?? null,
        toEmail: args.toEmail.trim().toLowerCase(),
        // Subject can occasionally exceed 255 chars (forwarded mail
        // patterns, locale expansion). Truncate defensively rather
        // than throwing — we never want a logging failure to block
        // the actual send.
        subject: args.subject.length > 255 ? args.subject.slice(0, 255) : args.subject,
        audienceId: args.audienceId ?? null,
        trigger: args.trigger ?? null,
        source: args.source,
        status: args.status,
        resendId: args.resendId ?? null,
        error: args.error ?? null,
      })
      .returning({ id: emailSendLog.id });
    return rows[0]?.id ?? null;
  } catch {
    // Intentional swallow — fallback to console at the call site
    // would just create noise. The send itself is unaffected.
    return null;
  }
}

interface UpdateSendStatusArgs {
  id: string;
  clubId: string;
  status: EmailSendStatus;
  resendId?: string | null;
  error?: string | null;
}

/**
 * Flips a queued row to its terminal state. Scoped to (id, clubId)
 * so a tampered request can't cross tenants — though the caller is
 * the server, this defence costs us nothing.
 */
export async function updateEmailSendStatus(args: UpdateSendStatusArgs): Promise<void> {
  try {
    await db
      .update(emailSendLog)
      .set({
        status: args.status,
        resendId: args.resendId ?? null,
        error: args.error ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(emailSendLog.id, args.id), eq(emailSendLog.clubId, args.clubId)));
  } catch {
    // See `recordEmailSend` rationale.
  }
}

interface ListSendsArgs {
  clubId: string;
  status?: EmailSendStatus;
  source?: EmailSendSource;
  page: number;
  pageSize: number;
}

interface SendLogRow {
  id: string;
  toEmail: string;
  subject: string;
  source: EmailSendSource;
  status: EmailSendStatus;
  trigger: string | null;
  audienceId: string | null;
  audienceName: string | null;
  senderDisplayName: string | null;
  resendId: string | null;
  error: string | null;
  createdAt: Date;
}

/**
 * Paginated, club-scoped send-log listing. JOINs audiences for the
 * display name and club_members for the sender's name so the UI
 * doesn't need an N+1 fetch loop.
 */
export async function listEmailSendsForClub(args: ListSendsArgs): Promise<{
  data: SendLogRow[];
  total: number;
}> {
  const conditions = [eq(emailSendLog.clubId, args.clubId)];
  if (args.status) conditions.push(eq(emailSendLog.status, args.status));
  if (args.source) conditions.push(eq(emailSendLog.source, args.source));
  const where = and(...conditions);
  const offset = (args.page - 1) * args.pageSize;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: emailSendLog.id,
        toEmail: emailSendLog.toEmail,
        subject: emailSendLog.subject,
        source: emailSendLog.source,
        status: emailSendLog.status,
        trigger: emailSendLog.trigger,
        audienceId: emailSendLog.audienceId,
        audienceName: audiences.name,
        senderDisplayName: clubMembers.displayName,
        resendId: emailSendLog.resendId,
        error: emailSendLog.error,
        createdAt: emailSendLog.createdAt,
      })
      .from(emailSendLog)
      .leftJoin(audiences, eq(emailSendLog.audienceId, audiences.id))
      .leftJoin(
        clubMembers,
        and(
          eq(emailSendLog.senderMemberId, clubMembers.id),
          eq(emailSendLog.clubId, clubMembers.clubId),
        ),
      )
      .where(where)
      .orderBy(desc(emailSendLog.createdAt))
      .limit(args.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailSendLog)
      .where(where),
  ]);

  return {
    data: rows.map((r) => ({
      ...r,
      source: r.source as EmailSendSource,
      status: r.status as EmailSendStatus,
    })),
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Retention helper — keep this here so a future cron / cleanup script
 * has a single audited entry point. Returns the number of rows
 * deleted. Status is included so a future caller can purge only
 * 'sent'/'failed' rows while keeping 'suppressed' for the audit trail.
 */
export async function deleteOldEmailSendLogs(args: {
  olderThan: Date;
  statuses?: EmailSendStatus[];
}): Promise<number> {
  const conditions = [sql`${emailSendLog.createdAt} < ${args.olderThan.toISOString()}`];
  if (args.statuses?.length) {
    conditions.push(inArray(emailSendLog.status, args.statuses));
  }
  const result = await db
    .delete(emailSendLog)
    .where(and(...conditions))
    .returning({ id: emailSendLog.id });
  return result.length;
}
