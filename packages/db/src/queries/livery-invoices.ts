import { and, asc, eq, sql, lte, inArray, desc, isNull, gt, type SQL } from 'drizzle-orm';
import { db, rawDb, writeTransaction } from '../index';
import { liveryInvoices } from '../schema/livery-invoices';
import { horses } from '../schema/horses';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

type NewInvoice = typeof liveryInvoices.$inferInsert;

/**
 * The cron's workhorse lookup. Returns every approved-active horse whose
 * next livery period should start on or before `today` and has no existing
 * invoice covering that period yet.
 *
 * Billing anniversary: the day-of-month of `livery_start_date`. For a horse
 * approved with livery_start_date = 2026-05-15, invoices should be cut on
 * May 15, June 15, July 15, … covering `[start, start+1 month)`. This query
 * does the period calculation in JS rather than SQL so that edge cases (29th
 * → Feb) are easier to reason about.
 */
export interface BillableHorse {
  horseId: string;
  horseName: string;
  clubId: string;
  clubName: string;
  clubCurrency: string;
  /** Club IANA timezone — used by the cron to derive a per-club "today"
   * so non-GCC clubs aren't billed on the wrong calendar date (audit G-3). */
  clubTimezone: string;
  ownerMemberId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerClerkUserId: string;
  monthlyLiveryFeeMinor: number;
  liveryStartDate: string;
  liveryEndDate: string | null;
  lastInvoicePeriodStart: string | null;
}

/**
 * Audit r6 F-14 (2026-05-08): cap on the cron's per-pass scan size. The
 * cron is daily and partial passes are inherently safe — the next day's
 * run picks up whatever this pass didn't reach. The limit binds well
 * before the worker's 5min wallclock budget would (each row drives a
 * sequential `findHorseBillingAnchor` round-trip, plus an INSERT per
 * billable period). Tunable via `LIVERY_BILLING_CRON_LIMIT` for
 * operators who need to widen it in the rare case a cron run is skipped
 * for multiple days. Mirrors the bounding pattern in `pruneAuditLog`.
 *
 * The query orders by `liveryStartDate DESC` so that when the limit
 * binds, newer horses (likelier to be in their first or second billing
 * period and therefore have a tighter SLA on their first invoice) win
 * over older ones whose existing periods are already covered.
 */
const LIVERY_BILLING_CRON_LIMIT = (() => {
  const raw = Number(process.env.LIVERY_BILLING_CRON_LIMIT);
  if (Number.isFinite(raw) && raw >= 100 && raw <= 100_000) return raw;
  return 1000;
})();

export async function findHorsesDueForBilling(today: string): Promise<BillableHorse[]> {
  // Anchor: last invoice per horse (max period_start). We left-join so horses
  // that have never been billed still appear. `rawDb` because this is called
  // from the cron handler, outside any tenant transaction.
  //
  // Audit pass-4 P-1 (2026-05-10): the WHERE on `inArray(status, ...)` used
  // to filter out `'cancelled'`, which silently diverged from the semantics
  // `findHorseBillingAnchor` returns (any latest invoice, irrespective of
  // status). The cron historically used the round-trip helper because of
  // that divergence; now that the pre-join consumer (the cron itself) is
  // wired to `lastInvoicePeriodStart`, the pre-join must match the helper's
  // semantics. A horse whose latest invoice was cancelled correctly skips
  // re-issuing the cancelled period — `nextBillingPeriod` advances to
  // `cancelled.periodStart + 1 month`. If the LEFT JOIN had stayed
  // status-filtered, the next cron run would have re-issued the cancelled
  // period, undoing the operator's cancel.
  const lastInvoiceSub = rawDb
    .select({
      clubId: liveryInvoices.clubId,
      horseId: liveryInvoices.horseId,
      lastStart: sql<string | null>`MAX(${liveryInvoices.periodStart})`.as('last_start'),
    })
    .from(liveryInvoices)
    .groupBy(liveryInvoices.clubId, liveryInvoices.horseId)
    .as('last_invoice_sub');

  const rows = await rawDb
    .select({
      horseId: horses.id,
      horseName: horses.name,
      clubId: horses.clubId,
      clubName: clubs.name,
      clubCurrency: clubs.currency,
      clubTimezone: clubs.timezone,
      ownerMemberId: horses.ownerMemberId,
      ownerEmail: clubMembers.email,
      ownerName: clubMembers.displayName,
      ownerClerkUserId: clubMembers.clerkUserId,
      monthlyLiveryFeeMinor: horses.monthlyLiveryFeeMinor,
      liveryStartDate: horses.liveryStartDate,
      liveryEndDate: horses.liveryEndDate,
      lastInvoicePeriodStart: lastInvoiceSub.lastStart,
    })
    .from(horses)
    .innerJoin(clubs, eq(clubs.id, horses.clubId))
    // Audit F-1/F-9 (2026-05-06 comprehensive): bind clubMembers.clubId
    // to horses.clubId so a future writer that bypasses the route-level
    // membership check can't surface cross-tenant rows here. Migration
    // 0040 also adds the matching composite FK at the schema layer.
    .innerJoin(
      clubMembers,
      and(eq(clubMembers.id, horses.ownerMemberId), eq(clubMembers.clubId, horses.clubId)),
    )
    .leftJoin(
      lastInvoiceSub,
      and(eq(lastInvoiceSub.horseId, horses.id), eq(lastInvoiceSub.clubId, horses.clubId)),
    )
    .where(
      and(
        eq(horses.ownershipStatus, 'active'),
        lte(horses.liveryStartDate, today),
        gt(horses.monthlyLiveryFeeMinor, 0),
        isNull(horses.deletedAt),
        // Soft-deleted clubs (Clerk org.deleted webhook flips this) must
        // stop billing — see audit B-29 / F-1.
        isNull(clubs.deletedAt),
      ),
    )
    // Audit r6 F-14: see comment on LIVERY_BILLING_CRON_LIMIT above.
    .orderBy(desc(horses.liveryStartDate))
    .limit(LIVERY_BILLING_CRON_LIMIT);

  return rows.filter(
    (
      r,
    ): r is typeof r & {
      ownerMemberId: string;
      ownerEmail: string | null;
      ownerClerkUserId: string;
      monthlyLiveryFeeMinor: number;
      liveryStartDate: string;
    } => {
      return !!r.ownerMemberId && r.monthlyLiveryFeeMinor != null && !!r.liveryStartDate;
    },
  );
}

/**
 * Audit F-35 (2026-05-07 r5): clubId scope is now mandatory. The
 * composite FK on `(horse_id, club_id)` already prevents cross-tenant
 * rows from being inserted, so this is defense-in-depth — a future
 * migration that loosens the constraint would otherwise re-open the
 * cross-tenant read. CLAUDE.md rule #11 ("EVERY query MUST include
 * the club_id tenant scope") applies even when an upstream invariant
 * happens to enforce it.
 */
export async function findHorseBillingAnchor(clubId: string, horseId: string) {
  const latest = await rawDb
    .select({
      id: liveryInvoices.id,
      periodStart: liveryInvoices.periodStart,
      periodEnd: liveryInvoices.periodEnd,
      status: liveryInvoices.status,
    })
    .from(liveryInvoices)
    .where(and(eq(liveryInvoices.horseId, horseId), eq(liveryInvoices.clubId, clubId)))
    .orderBy(desc(liveryInvoices.periodStart))
    .limit(1);
  return latest[0] ?? null;
}

interface CreateInvoiceInput {
  clubId: string;
  horseId: string;
  ownerMemberId: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  paymentProvider?: string;
  providerPaymentId?: string;
  payLink?: string;
}

export async function createLiveryInvoice(input: CreateInvoiceInput) {
  const values: NewInvoice = {
    clubId: input.clubId,
    horseId: input.horseId,
    ownerMemberId: input.ownerMemberId,
    invoiceNumber: input.invoiceNumber,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    dueDate: input.dueDate,
    paymentProvider: input.paymentProvider,
    providerPaymentId: input.providerPaymentId,
    payLink: input.payLink,
    status: 'pending',
  };
  // rawDb — cron runs outside tenant context; status check is horse-scoped.
  //
  // Audit F-4 (2026-05-07 r5): the unique constraint on
  // `(horse_id, period_start)` is the partial index
  // `livery_invoices_unique_horse_period_active` (migration 0027) with a
  // `WHERE status <> 'cancelled'` predicate. Postgres requires the
  // ON CONFLICT predicate to match — without `targetWhere`, the insert
  // raises SQLSTATE 42P10 ("no unique or exclusion constraint matching
  // the ON CONFLICT specification") instead of behaving as a quiet
  // no-op. The cron's idempotency contract relies on this being a
  // no-op on retries against horses with an outstanding invoice.
  const result = await rawDb
    .insert(liveryInvoices)
    .values(values)
    .onConflictDoNothing({
      target: [liveryInvoices.horseId, liveryInvoices.periodStart],
      // `where` here is Drizzle 0.45 spelling for the index predicate
      // matching the partial unique
      // `livery_invoices_unique_horse_period_active` (migration 0027).
      where: sql`status <> 'cancelled'`,
    })
    .returning();
  return result[0] ?? null;
}

/**
 * Marks an invoice paid idempotently. Won't move a terminal `cancelled`
 * invoice back to paid — call `clearCancellation` first if that's intended.
 *
 * `clubId` is mandatory (audit AI-22 / CLAUDE.md): the invoice id alone
 * isn't enough — a webhook routing bug or a future caller that derives
 * `invoiceId` from a less-trusted source could otherwise mark a foreign
 * tenant's invoice paid.
 */
export async function markLiveryInvoicePaid(
  clubId: string,
  invoiceId: string,
  paid: { paidAt: Date; paymentProvider?: string; providerPaymentId?: string },
) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      status: 'paid',
      paidAt: paid.paidAt,
      paymentProvider: paid.paymentProvider,
      providerPaymentId: paid.providerPaymentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

export async function findLiveryInvoiceByProviderPayment(
  providerPaymentId: string,
  provider: string,
  /**
   * Audit MED (2026-05-05 pass 2): when the caller has the URL's
   * clubId in hand — every webhook receiver does, since the URL pattern
   * is `/api/webhooks/<provider>/[clubId]` — pass it here. The lookup
   * binds both `(providerPaymentId, provider)` AND `clubId`, so a
   * future provider-payment-id collision (Ziina docs reserve the right
   * to reuse intent ids across merchants under specific edge cases)
   * can never resolve to another club's invoice. Optional for legacy
   * callers; the `applyLiveryInvoiceWebhook` route-side helper now
   * always passes it.
   */
  clubId?: string,
) {
  // Audit HIGH-9 (2026-05-05): match on `providerPaymentId` regardless of
  // whether `paymentProvider` is NULL or matches. The cron writes the
  // provider id via `setInvoiceProviderRef`, but the webhook can land
  // BEFORE that write completes (fast-succeed race) — leaving the row
  // with `provider_payment_id = $id` but `payment_provider = NULL`. The
  // prior strict match dropped those events silently. The
  // `payment_provider IS NULL OR =` predicate accepts both states; the
  // routing layer (caller) already knows which provider this is and
  // tags audit logs accordingly.
  const conditions = [
    eq(liveryInvoices.providerPaymentId, providerPaymentId),
    sql`(${liveryInvoices.paymentProvider} IS NULL OR ${liveryInvoices.paymentProvider} = ${provider})`,
  ];
  if (clubId) {
    conditions.push(eq(liveryInvoices.clubId, clubId));
  }

  const rows = await rawDb
    .select({
      id: liveryInvoices.id,
      clubId: liveryInvoices.clubId,
      horseId: liveryInvoices.horseId,
      ownerMemberId: liveryInvoices.ownerMemberId,
      status: liveryInvoices.status,
      amountMinorUnits: liveryInvoices.amountMinorUnits,
      currency: liveryInvoices.currency,
      invoiceNumber: liveryInvoices.invoiceNumber,
      periodStart: liveryInvoices.periodStart,
      periodEnd: liveryInvoices.periodEnd,
    })
    .from(liveryInvoices)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Invoices that have slipped past due_date but are still pending. Bumps them
 * to `overdue` and returns them so the caller can email reminders. A single
 * pass handles the 7/14/30 day cadence — `reminder_count` tracks progression.
 */
export async function findOverdueInvoicesForReminders(today: string) {
  const rows = await rawDb
    .select({
      invoiceId: liveryInvoices.id,
      clubId: liveryInvoices.clubId,
      clubTimezone: clubs.timezone,
      horseId: liveryInvoices.horseId,
      ownerMemberId: liveryInvoices.ownerMemberId,
      invoiceNumber: liveryInvoices.invoiceNumber,
      dueDate: liveryInvoices.dueDate,
      amountMinorUnits: liveryInvoices.amountMinorUnits,
      currency: liveryInvoices.currency,
      payLink: liveryInvoices.payLink,
      lastReminderAt: liveryInvoices.lastReminderAt,
      reminderCount: liveryInvoices.reminderCount,
      status: liveryInvoices.status,
      horseName: horses.name,
      clubName: clubs.name,
      ownerEmail: clubMembers.email,
      ownerName: clubMembers.displayName,
    })
    .from(liveryInvoices)
    // Bind clubId on every join (audit AI-22). Without this, a row with a
    // mis-tenanted owner_member_id or horse_id (planted by a future bug)
    // would surface that tenant's display name on this club's reminder.
    .innerJoin(
      horses,
      and(eq(horses.id, liveryInvoices.horseId), eq(horses.clubId, liveryInvoices.clubId)),
    )
    .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
    .innerJoin(
      clubMembers,
      and(
        eq(clubMembers.id, liveryInvoices.ownerMemberId),
        eq(clubMembers.clubId, liveryInvoices.clubId),
      ),
    )
    .where(
      and(
        inArray(liveryInvoices.status, ['pending', 'overdue']),
        lte(liveryInvoices.dueDate, today),
        // Don't keep reminding owners of a club that's been deleted —
        // see audit F-1.
        isNull(clubs.deletedAt),
        isNull(horses.deletedAt),
      ),
    )
    // Bounded run-time so the cron can't hit Workers' wall-clock budget on
    // a sustained backlog. Earliest reminder_count first so the day-7 nudge
    // doesn't get systematically skipped while the cron processes day-30s
    // (audit G-13). Operators monitoring `cron_capacity_hit` should bump
    // this if it pegs.
    .orderBy(asc(liveryInvoices.reminderCount), asc(liveryInvoices.dueDate))
    .limit(200);
  return rows;
}

// `clubId` is threaded through these helpers as defence-in-depth. Today's
// callers (cron + provider webhooks) hand back a row that already carries
// the right clubId, so the constraint is redundant — but a future caller
// that derives `invoiceId` from a less-trusted source (e.g. a rider portal
// route exposing owner-side invoice ops) would otherwise have no DB-level
// guard against acting on a foreign-club row.
//
// CAS on `reminder_count`: two cron isolates that read the same row in the
// same threshold window (Cloudflare can replay scheduled() across regions
// or operator-triggered, plus the worker-entry retries on 5xx) would each
// bump the counter and each fire the email. The CAS makes the bump atomic:
// the loser sees `null` and the caller skips the send. Symmetric to
// `markBookingReminderSent`'s CAS pattern.
export async function markInvoiceOverdueAndLogReminder(
  clubId: string,
  invoiceId: string,
  expectedReminderCount: number,
) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      status: 'overdue',
      lastReminderAt: new Date(),
      reminderCount: sql`${liveryInvoices.reminderCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        inArray(liveryInvoices.status, ['pending', 'overdue']),
        eq(liveryInvoices.reminderCount, expectedReminderCount),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * One-shot `pending → overdue` transition that leaves `reminder_count`
 * untouched. Used by the cron when an invoice is past due but the owner
 * has no email on file (audit G-2): bumping the counter would burn through
 * the 7/14/30-day cadence on rows that never sent anything, leaving them
 * permanently silent once the admin patches the email later. Idempotent
 * — a second call after the row is already overdue is a no-op.
 */
export async function markInvoiceOverdueOnly(clubId: string, invoiceId: string) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      status: 'overdue',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        eq(liveryInvoices.status, 'pending'),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Attach a provider payment reference to an already-created invoice.
 *
 * Audit F-2 (2026-05-07 r5): CAS guard mirrors `setBookingPaymentRef`
 * (bookings.ts) — the WHERE refuses to overwrite an existing
 * `provider_payment_id` with a different value, and refuses to act on
 * terminal-state rows (paid/cancelled). Without this, two races corrupt
 * the ledger:
 *
 *   1. Reminder-regeneration race: cron mints a fresh intent on day-7
 *      AND day-14 reminders. If the owner pays the day-7 link
 *      concurrently with the day-14 regeneration, the day-14 cron
 *      overwrites `providerPaymentId = PI_new` BEFORE Ziina's `payment_
 *      intent.status.updated` for `PI_old` lands. The webhook lookup
 *      for `PI_old` then misses → invoice stays pending → owner thinks
 *      they paid → money sits unreconciled in the merchant balance.
 *
 *   2. Cancelled-invoice writeback: an invoice that's been cancelled
 *      between cron read and write should not have its provider ref
 *      updated — terminal-state predicate guards this.
 *
 * Returns null when the CAS rejects (caller's signal that the row is
 * already pointed at this intent OR is in a terminal state); behaves
 * the same as today's "no row matched" path for callers, which all
 * already null-handle the result.
 */
export async function setInvoiceProviderRef(
  clubId: string,
  invoiceId: string,
  provider: string,
  providerPaymentId: string,
  payLink?: string,
) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      paymentProvider: provider,
      providerPaymentId,
      payLink,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        sql`(${liveryInvoices.providerPaymentId} IS NULL OR ${liveryInvoices.providerPaymentId} = ${providerPaymentId})`,
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/** Admin-facing listing on the horse detail page. */
export async function getLiveryInvoicesByHorse(
  clubId: string,
  horseId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const conditions: SQL[] = [
    eq(liveryInvoices.clubId, clubId),
    eq(liveryInvoices.horseId, horseId),
  ];
  const where = and(...conditions);
  // Audit F-32: explicit projection mirroring livery-tab.tsx
  // consumption. Drops `lastReminderAt`, `reminderCount`, and
  // `updatedAt` — admin UI doesn't surface them on the per-horse list.
  const [items, count] = await Promise.all([
    db
      .select({
        id: liveryInvoices.id,
        clubId: liveryInvoices.clubId,
        horseId: liveryInvoices.horseId,
        ownerMemberId: liveryInvoices.ownerMemberId,
        invoiceNumber: liveryInvoices.invoiceNumber,
        periodStart: liveryInvoices.periodStart,
        periodEnd: liveryInvoices.periodEnd,
        amountMinorUnits: liveryInvoices.amountMinorUnits,
        currency: liveryInvoices.currency,
        status: liveryInvoices.status,
        dueDate: liveryInvoices.dueDate,
        paidAt: liveryInvoices.paidAt,
        cancelledAt: liveryInvoices.cancelledAt,
        paymentProvider: liveryInvoices.paymentProvider,
        providerPaymentId: liveryInvoices.providerPaymentId,
        payLink: liveryInvoices.payLink,
        createdAt: liveryInvoices.createdAt,
      })
      .from(liveryInvoices)
      .where(where)
      .orderBy(desc(liveryInvoices.periodStart))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(liveryInvoices)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

/** List-row shape for `getLiveryInvoicesByHorse` (audit F-32). */
export type LiveryInvoiceByHorseListItem = Awaited<
  ReturnType<typeof getLiveryInvoicesByHorse>
>['items'][number];

/** Owner-facing listing for the rider portal. */
export async function getLiveryInvoicesOwnedByUser(
  clerkUserId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const where = and(
    eq(clubMembers.clerkUserId, clerkUserId),
    eq(clubMembers.isActive, true),
    // Hide tombstoned clubs / soft-deleted horses from the rider's
    // "My horses" invoices view — see audit F-1 / F-2.
    isNull(clubs.deletedAt),
    isNull(horses.deletedAt),
  );
  const [items, count] = await Promise.all([
    rawDb
      .select({
        id: liveryInvoices.id,
        clubId: liveryInvoices.clubId,
        horseId: liveryInvoices.horseId,
        horseName: horses.name,
        clubName: clubs.name,
        invoiceNumber: liveryInvoices.invoiceNumber,
        periodStart: liveryInvoices.periodStart,
        periodEnd: liveryInvoices.periodEnd,
        amountMinorUnits: liveryInvoices.amountMinorUnits,
        currency: liveryInvoices.currency,
        status: liveryInvoices.status,
        dueDate: liveryInvoices.dueDate,
        paidAt: liveryInvoices.paidAt,
        payLink: liveryInvoices.payLink,
      })
      .from(liveryInvoices)
      // Bind clubId on every join (audit AI-22).
      .innerJoin(
        horses,
        and(eq(horses.id, liveryInvoices.horseId), eq(horses.clubId, liveryInvoices.clubId)),
      )
      .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
      .innerJoin(
        clubMembers,
        and(
          eq(clubMembers.id, liveryInvoices.ownerMemberId),
          eq(clubMembers.clubId, liveryInvoices.clubId),
        ),
      )
      .where(where)
      .orderBy(desc(liveryInvoices.periodStart))
      .limit(pageSize)
      .offset(offset),
    rawDb
      .select({ count: sql<number>`count(*)::int` })
      .from(liveryInvoices)
      .innerJoin(
        horses,
        and(eq(horses.id, liveryInvoices.horseId), eq(horses.clubId, liveryInvoices.clubId)),
      )
      .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
      .innerJoin(
        clubMembers,
        and(
          eq(clubMembers.id, liveryInvoices.ownerMemberId),
          eq(clubMembers.clubId, liveryInvoices.clubId),
        ),
      )
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

/**
 * Fetches the details needed to render the receipt / reminder / issued
 * emails — horse name, club name, owner contact. Used by any code path that
 * needs to email about an invoice without knowing those details up front
 * (webhooks, manual mark-paid, future one-off triggers).
 */
export async function getLiveryInvoiceForEmail(clubId: string, invoiceId: string) {
  const rows = await db
    .select({
      id: liveryInvoices.id,
      clubId: liveryInvoices.clubId,
      horseId: liveryInvoices.horseId,
      ownerMemberId: liveryInvoices.ownerMemberId,
      invoiceNumber: liveryInvoices.invoiceNumber,
      amountMinorUnits: liveryInvoices.amountMinorUnits,
      currency: liveryInvoices.currency,
      periodStart: liveryInvoices.periodStart,
      periodEnd: liveryInvoices.periodEnd,
      dueDate: liveryInvoices.dueDate,
      paidAt: liveryInvoices.paidAt,
      horseName: horses.name,
      clubName: clubs.name,
      ownerEmail: clubMembers.email,
      ownerName: clubMembers.displayName,
    })
    .from(liveryInvoices)
    // Bind clubId on every join (audit AI-22).
    .innerJoin(
      horses,
      and(eq(horses.id, liveryInvoices.horseId), eq(horses.clubId, liveryInvoices.clubId)),
    )
    .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
    .innerJoin(
      clubMembers,
      and(
        eq(clubMembers.id, liveryInvoices.ownerMemberId),
        eq(clubMembers.clubId, liveryInvoices.clubId),
      ),
    )
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        // Don't render emails for deleted clubs / archived horses — F-1 / F-2.
        isNull(clubs.deletedAt),
        isNull(horses.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Admin manual mark-paid (for off-platform payments). */
export async function manualMarkLiveryInvoicePaid(clubId: string, invoiceId: string, paidAt: Date) {
  const result = await db
    .update(liveryInvoices)
    .set({
      status: 'paid',
      paidAt,
      // Reset reminder cadence so an admin re-issuing this invoice (via a
      // future void+reissue tool) doesn't inherit a stale reminder_count
      // that would skip the day-7 nudge — see audit E-15. Setting to 0
      // / null is safe even on a paid invoice; the reminder query won't
      // pick it up since status='paid' is excluded.
      lastReminderAt: null,
      reminderCount: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Cancels every pending/overdue invoice for a horse. Called when ownership
 * is retired so the billing cron stops chasing the departed owner. Uses
 * `db` (not `rawDb`) so the retire route can wrap this together with
 * `retireHorseOwnership` in a single `writeTransaction` — see audit G-6.
 * Standalone callers outside a transaction get HTTP semantics via the
 * proxy fallback.
 */
export async function cancelPendingInvoicesForHorse(clubId: string, horseId: string) {
  const result = await db
    .update(liveryInvoices)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.horseId, horseId),
        eq(liveryInvoices.clubId, clubId),
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning({ id: liveryInvoices.id });
  return result.length;
}

/** Admin cancel — e.g. disputed invoice that should be voided. */
export async function cancelLiveryInvoice(clubId: string, invoiceId: string) {
  const result = await db
    .update(liveryInvoices)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(liveryInvoices.id, invoiceId),
        eq(liveryInvoices.clubId, clubId),
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Simple sequential invoice number per club. Format: `LIV-{clubSlug}-{n}`
 * where n is the current count of livery invoices for that club + 1.
 *
 * Concurrent callers can both compute the same `n`; the
 * `livery_invoices_club_number_unique` index ensures only one wins, and
 * `createLiveryInvoiceWithGeneratedNumber` retries on the resulting
 * 23505 with a fresh number — see audit G-4.
 */
export async function nextLiveryInvoiceNumber(clubId: string) {
  const result = await rawDb
    .select({ count: sql<number>`count(*)::int` })
    .from(liveryInvoices)
    .where(eq(liveryInvoices.clubId, clubId));
  const n = (result[0]?.count ?? 0) + 1;
  return `LIV-${clubId.slice(0, 6)}-${String(n).padStart(5, '0')}`;
}

/**
 * Issue a livery invoice with a freshly-generated unique number, retrying
 * on the per-club (club_id, invoice_number) unique-index collision that
 * concurrent cron runs would otherwise produce. The (horse_id,
 * period_start) idempotency conflict is still handled by createLiveryInvoice's
 * onConflictDoNothing — that path returns null (already issued).
 *
 * Returns the issued invoice (with its allocated number) or null if the
 * (horse, period) idempotency caught it.
 */
type CreateLiveryInvoiceWithoutNumber = Omit<CreateInvoiceInput, 'invoiceNumber'>;

export async function createLiveryInvoiceWithGeneratedNumber(
  input: CreateLiveryInvoiceWithoutNumber,
): Promise<NonNullable<Awaited<ReturnType<typeof createLiveryInvoice>>> | null> {
  // Audit HIGH-10 (2026-05-05): take a per-club Postgres advisory
  // transaction lock around the COUNT+INSERT so concurrent callers
  // serialise on the lock instead of racing the COUNT and burning
  // through the retry budget. The lock auto-releases at tx commit/rollback.
  // `hashtext` is deterministic per-string, so two concurrent calls for
  // the same clubId hash to the same lock id and queue cleanly. The
  // 23505 retry loop is preserved as belt-and-braces for the (rare)
  // case where a non-locked admin path adds a row in parallel.
  return writeTransaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('livery_invoice_number:' || ${input.clubId}))`,
    );
    const MAX_ATTEMPTS = 8;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // Recompute COUNT inside the locked tx — guaranteed monotonic
      // for this clubId until commit.
      const result = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(liveryInvoices)
        .where(eq(liveryInvoices.clubId, input.clubId));
      const n = (result[0]?.count ?? 0) + 1;
      const invoiceNumber = `LIV-${input.clubId.slice(0, 6)}-${String(n).padStart(5, '0')}`;
      try {
        const values: NewInvoice = {
          clubId: input.clubId,
          horseId: input.horseId,
          ownerMemberId: input.ownerMemberId,
          invoiceNumber,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amountMinorUnits: input.amountMinorUnits,
          currency: input.currency,
          dueDate: input.dueDate,
          paymentProvider: input.paymentProvider,
          providerPaymentId: input.providerPaymentId,
          payLink: input.payLink,
          status: 'pending',
        };
        // Audit F-4 (2026-05-07 r5): mirror the predicate on the
        // partial unique index. See createLiveryInvoice for the same
        // fix; both sites share the same idempotency contract.
        const inserted = await tx
          .insert(liveryInvoices)
          .values(values)
          .onConflictDoNothing({
            target: [liveryInvoices.horseId, liveryInvoices.periodStart],
            // `where` here is Drizzle 0.45 spelling for the index
            // predicate matching the partial unique
            // `livery_invoices_unique_horse_period_active` (migration
            // 0027). See createLiveryInvoice for the same fix.
            where: sql`status <> 'cancelled'`,
          })
          .returning();
        return inserted[0] ?? null;
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : '';
        const constraint =
          err && typeof err === 'object' && 'constraint' in err
            ? String((err as { constraint: unknown }).constraint)
            : '';
        if (code === '23505' && constraint === 'livery_invoices_club_number_unique') {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `Failed to allocate unique livery invoice number after ${MAX_ATTEMPTS} attempts (clubId=${input.clubId}): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  });
}
