import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../index';
import { emailSuppressions } from '../schema/operations';

/**
 * Audit pass-7 integration followup ⑤ (2026-05-25): suppression list
 * read/write helpers used by the Resend webhook handler and the email
 * send paths (`apps/web/lib/email.ts`, `apps/web/lib/email-support.ts`).
 *
 * Phase 1 of the integration audit shipped the Resend webhook handler
 * (PR #181) ingesting bounces/complaints at log-only level. Phase 2
 * (this) adds the table + check so we actually stop sending to those
 * addresses.
 */

export type SuppressionReason = 'bounced' | 'complained' | 'manual';
export type SuppressionSource = 'resend_webhook' | 'manual';

interface AddSuppressionArgs {
  email: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  bounceSubtype?: string;
  notes?: string;
  /**
   * Task #21 (2026-05-28): manual suppressions are scoped to the club
   * that added them; resend-webhook suppressions stay global (NULL).
   * Migration 0065 enforces the pairing with a CHECK constraint, so
   * callers passing the wrong combination will see a runtime DB error.
   */
  clubId?: string | null;
}

/**
 * Returns true when `email` should NOT be sent to.
 *
 * Email comparison is lower-case to match RFC 5321 §2.3.11 — local-parts
 * are case-sensitive in principle but in practice nobody enforces that,
 * and Resend's webhook payloads aren't guaranteed case-stable. Storing
 * normalized + querying normalized keeps the lookup deterministic.
 *
 * Task #21 (2026-05-28): club-aware. The new manual+global split means
 * a club-scoped send must check (global webhook row) OR (manual row
 * scoped to this club) — NOT all manual rows. Without this, Club A's
 * manual suppression of `x@y.com` would block Club B's sends to the
 * same address (codex iter-2 P1).
 *
 *   - `clubId` provided → match active rows where
 *       (source='resend_webhook') OR (source='manual' AND club_id=clubId)
 *   - `clubId` omitted (e.g., operational mail with no tenant context)
 *     → match active rows where source='resend_webhook'. We deliberately
 *     do NOT consult manual rows here: there's no club to scope against,
 *     so honoring any club's manual row would re-introduce the leak.
 */
export async function isEmailSuppressed(email: string, clubId?: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const scopeClause = clubId
    ? sql`(${emailSuppressions.source} = 'resend_webhook' OR (${emailSuppressions.source} = 'manual' AND ${emailSuppressions.clubId} = ${clubId}))`
    : sql`${emailSuppressions.source} = 'resend_webhook'`;
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(
        eq(sql`lower(${emailSuppressions.email})`, normalized),
        isNull(emailSuppressions.retiredAt),
        scopeClause,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Add an email to the suppression list. Idempotent — if a row already
 * exists for this email + source (+ club_id for manual) and it's still
 * active (`retired_at IS NULL`), the new event is silently absorbed.
 * If a row exists but is retired, it's re-activated by clearing
 * `retired_at` and writing through the new reason/subtype/notes.
 *
 * Conflict targets:
 *   - source='resend_webhook': partial unique on (email) — one global
 *     webhook row per address. Hits `email_suppressions_webhook_unique`.
 *   - source='manual':         partial unique on (email, club_id) — one
 *     manual row per (address, club). Hits `email_suppressions_manual_unique`.
 *
 * The two indexes are independent, so a global webhook row can coexist
 * with one manual row per club for the same email. `isEmailSuppressed`
 * matches ANY active row, so a global bounce still protects every
 * tenant; an admin retiring their own manual row never erases the
 * global webhook protection.
 *
 * Returns whether a new row was inserted vs. an existing one matched.
 */
export async function addEmailSuppression(args: AddSuppressionArgs): Promise<{
  email: string;
  inserted: boolean;
}> {
  const normalized = args.email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('addEmailSuppression: email is required');
  }
  // Mirror the DB CHECK from migration 0065 in the app layer so a
  // future caller passing the wrong pairing fails at the call site
  // with a clear error rather than a Postgres constraint violation
  // wrapped in a 500 deep in the stack.
  if (args.source === 'manual' && !args.clubId) {
    throw new Error('addEmailSuppression: clubId is required when source = "manual"');
  }
  if (args.source === 'resend_webhook' && args.clubId) {
    throw new Error('addEmailSuppression: clubId must be omitted when source = "resend_webhook"');
  }

  const clubId = args.clubId ?? null;

  // ON CONFLICT predicates must match the partial unique index whose
  // WHERE clause the row would land in — without `where:`, Postgres
  // raises SQLSTATE 42P10 ("no unique or exclusion constraint
  // matching"). Two separate dispatches keep the conflict target +
  // its WHERE in lockstep.
  const insert =
    args.source === 'resend_webhook'
      ? await db
          .insert(emailSuppressions)
          .values({
            email: normalized,
            reason: args.reason,
            source: args.source,
            bounceSubtype: args.bounceSubtype,
            notes: args.notes,
            clubId,
          })
          .onConflictDoNothing({
            target: emailSuppressions.email,
            where: sql`source = 'resend_webhook'`,
          })
          .returning({ id: emailSuppressions.id })
      : await db
          .insert(emailSuppressions)
          .values({
            email: normalized,
            reason: args.reason,
            source: args.source,
            bounceSubtype: args.bounceSubtype,
            notes: args.notes,
            clubId,
          })
          .onConflictDoNothing({
            target: [emailSuppressions.email, emailSuppressions.clubId],
            where: sql`source = 'manual'`,
          })
          .returning({ id: emailSuppressions.id });

  if (insert[0]) {
    return { email: normalized, inserted: true };
  }

  // Conflict — row already exists. Re-activate if retired; otherwise
  // no-op. WHERE narrows to the SAME partial-unique tuple that the
  // INSERT targeted, so this never touches another source's row.
  const updateConditions = [
    eq(emailSuppressions.email, normalized),
    eq(emailSuppressions.source, args.source),
    // Only overwrite when the existing row is retired — re-bouncing
    // a long-quiet address. An already-active row stays untouched
    // (we don't want noisy retries from the same provider to keep
    // resetting `created_at`).
    sql`${emailSuppressions.retiredAt} IS NOT NULL`,
  ];
  if (args.source === 'manual') {
    // The manual partial unique is (email, club_id). Re-activation
    // must scope to the SAME club so Club A's POST never reaches
    // into Club B's retired row.
    updateConditions.push(eq(emailSuppressions.clubId, clubId as string));
  } else {
    updateConditions.push(isNull(emailSuppressions.clubId));
  }

  await db
    .update(emailSuppressions)
    .set({
      reason: args.reason,
      bounceSubtype: args.bounceSubtype,
      notes: args.notes,
      retiredAt: null,
      // `source` and `clubId` stay where they are — the partial
      // uniques + CHECK already pin the row's identity tuple to the
      // matching scope. Writing them again is a no-op given the
      // WHERE; omit to avoid implying we'd cross sources.
    })
    .where(and(...updateConditions));

  return { email: normalized, inserted: false };
}

/**
 * List a club's manually-added suppressions. Task #21 (2026-05-28).
 *
 * Only returns rows the club itself created (`source = 'manual' AND
 * club_id = ?`) — resend-webhook rows are global and intentionally
 * not exposed here to avoid leaking other clubs' bounce signal.
 */
export async function listManualSuppressionsForClub(
  clubId: string,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<{
  data: Array<{
    id: string;
    email: string;
    reason: SuppressionReason;
    notes: string | null;
    createdAt: Date;
  }>;
  total: number;
}> {
  const where = and(
    eq(emailSuppressions.clubId, clubId),
    eq(emailSuppressions.source, 'manual'),
    isNull(emailSuppressions.retiredAt),
  );
  const offset = (page - 1) * pageSize;
  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: emailSuppressions.id,
        email: emailSuppressions.email,
        reason: emailSuppressions.reason,
        notes: emailSuppressions.notes,
        createdAt: emailSuppressions.createdAt,
      })
      .from(emailSuppressions)
      .where(where)
      .orderBy(desc(emailSuppressions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailSuppressions)
      .where(where),
  ]);
  return {
    data: rows.map((r) => ({ ...r, reason: r.reason as SuppressionReason })),
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Retire a manually-added suppression for a specific club. Task #21
 * (2026-05-28).
 *
 * Scoped to `(club_id = ?, source = 'manual')` so a tampered request
 * can't retire another club's row or a global resend-webhook row.
 * Returns true if a row was retired, false otherwise.
 */
export async function retireManualSuppressionForClub(
  clubId: string,
  suppressionId: string,
): Promise<boolean> {
  const result = await db
    .update(emailSuppressions)
    .set({ retiredAt: new Date() })
    .where(
      and(
        eq(emailSuppressions.id, suppressionId),
        eq(emailSuppressions.clubId, clubId),
        eq(emailSuppressions.source, 'manual'),
        isNull(emailSuppressions.retiredAt),
      ),
    )
    .returning({ id: emailSuppressions.id });
  return result.length > 0;
}

// Note: the pre-#21 `retireEmailSuppression(email)` was removed.
// Retiring by `email` alone after migration 0065 would happily flip a
// global webhook row OR another club's manual row, breaking the
// scoping intent of the new partial uniques. Use
// `retireManualSuppressionForClub(clubId, id)` instead. A separate
// helper for retiring global webhook rows can be reintroduced if
// operator tooling needs it; it should require an explicit
// `source='resend_webhook'` predicate.
