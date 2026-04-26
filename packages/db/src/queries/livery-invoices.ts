import { and, asc, eq, sql, lte, inArray, desc, isNull, gt, type SQL } from 'drizzle-orm';
import { db, rawDb } from '../index';
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

export async function findHorsesDueForBilling(today: string): Promise<BillableHorse[]> {
  // Anchor: last invoice per horse (max period_start). We left-join so horses
  // that have never been billed still appear. `rawDb` because this is called
  // from the cron handler, outside any tenant transaction.
  const lastInvoiceSub = rawDb
    .select({
      horseId: liveryInvoices.horseId,
      lastStart: sql<string | null>`MAX(${liveryInvoices.periodStart})`.as('last_start'),
    })
    .from(liveryInvoices)
    .where(
      inArray(liveryInvoices.status, ['pending', 'paid', 'overdue']),
    )
    .groupBy(liveryInvoices.horseId)
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
    .innerJoin(clubMembers, eq(clubMembers.id, horses.ownerMemberId))
    .leftJoin(lastInvoiceSub, eq(lastInvoiceSub.horseId, horses.id))
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
    );

  return rows
    .filter((r): r is typeof r & {
      ownerMemberId: string;
      ownerEmail: string | null;
      ownerClerkUserId: string;
      monthlyLiveryFeeMinor: number;
      liveryStartDate: string;
    } => {
      return (
        !!r.ownerMemberId &&
        r.monthlyLiveryFeeMinor != null &&
        !!r.liveryStartDate
      );
    });
}

export async function findHorseBillingAnchor(horseId: string) {
  const latest = await rawDb
    .select({
      id: liveryInvoices.id,
      periodStart: liveryInvoices.periodStart,
      periodEnd: liveryInvoices.periodEnd,
      status: liveryInvoices.status,
    })
    .from(liveryInvoices)
    .where(eq(liveryInvoices.horseId, horseId))
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
  const result = await rawDb
    .insert(liveryInvoices)
    .values(values)
    .onConflictDoNothing({
      target: [liveryInvoices.horseId, liveryInvoices.periodStart],
    })
    .returning();
  return result[0] ?? null;
}

/**
 * Marks an invoice paid idempotently. Won't move a terminal `cancelled`
 * invoice back to paid — call `clearCancellation` first if that's intended.
 */
export async function markLiveryInvoicePaid(
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
        inArray(liveryInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

export async function findLiveryInvoiceByProviderPayment(
  providerPaymentId: string,
  provider: string,
) {
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
    .where(
      and(
        eq(liveryInvoices.providerPaymentId, providerPaymentId),
        eq(liveryInvoices.paymentProvider, provider),
      ),
    )
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
    .innerJoin(horses, eq(horses.id, liveryInvoices.horseId))
    .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
    .innerJoin(clubMembers, eq(clubMembers.id, liveryInvoices.ownerMemberId))
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
export async function markInvoiceOverdueAndLogReminder(clubId: string, invoiceId: string) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      status: 'overdue',
      lastReminderAt: new Date(),
      reminderCount: sql`${liveryInvoices.reminderCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(liveryInvoices.id, invoiceId), eq(liveryInvoices.clubId, clubId)))
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

/** Attach a provider payment reference to an already-created invoice. */
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
    .where(and(eq(liveryInvoices.id, invoiceId), eq(liveryInvoices.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

/** Admin-facing listing on the horse detail page. */
export async function getLiveryInvoicesByHorse(clubId: string, horseId: string) {
  const conditions: SQL[] = [
    eq(liveryInvoices.clubId, clubId),
    eq(liveryInvoices.horseId, horseId),
  ];
  return db
    .select()
    .from(liveryInvoices)
    .where(and(...conditions))
    .orderBy(desc(liveryInvoices.periodStart));
}

/** Owner-facing listing for the rider portal. */
export async function getLiveryInvoicesOwnedByUser(clerkUserId: string) {
  return rawDb
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
    .innerJoin(horses, eq(horses.id, liveryInvoices.horseId))
    .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
    .innerJoin(clubMembers, eq(clubMembers.id, liveryInvoices.ownerMemberId))
    .where(
      and(
        eq(clubMembers.clerkUserId, clerkUserId),
        eq(clubMembers.isActive, true),
        // Hide tombstoned clubs / soft-deleted horses from the rider's
        // "My horses" invoices view — see audit F-1 / F-2.
        isNull(clubs.deletedAt),
        isNull(horses.deletedAt),
      ),
    )
    .orderBy(desc(liveryInvoices.periodStart));
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
    .innerJoin(horses, eq(horses.id, liveryInvoices.horseId))
    .innerJoin(clubs, eq(clubs.id, liveryInvoices.clubId))
    .innerJoin(clubMembers, eq(clubMembers.id, liveryInvoices.ownerMemberId))
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
export async function manualMarkLiveryInvoicePaid(
  clubId: string,
  invoiceId: string,
  paidAt: Date,
) {
  const result = await db
    .update(liveryInvoices)
    .set({
      status: 'paid',
      paidAt,
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
  const MAX_ATTEMPTS = 8;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const invoiceNumber = await nextLiveryInvoiceNumber(input.clubId);
    try {
      const invoice = await createLiveryInvoice({ ...input, invoiceNumber });
      return invoice;
    } catch (err) {
      // Postgres 23505 unique-violation. Drizzle bubbles the underlying
      // PG error so we inspect `.code`. Only retry on the per-club number
      // index — any other 23505 is a real bug we shouldn't paper over.
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
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
}

