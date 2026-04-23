import { and, eq, sql, lte, inArray, desc, isNull, gt, type SQL } from 'drizzle-orm';
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
      ),
    );
  return rows;
}

export async function markInvoiceOverdueAndLogReminder(invoiceId: string) {
  const result = await rawDb
    .update(liveryInvoices)
    .set({
      status: 'overdue',
      lastReminderAt: new Date(),
      reminderCount: sql`${liveryInvoices.reminderCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(liveryInvoices.id, invoiceId))
    .returning();
  return result[0] ?? null;
}

/** Attach a provider payment reference to an already-created invoice. */
export async function setInvoiceProviderRef(
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
    .where(eq(liveryInvoices.id, invoiceId))
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
 * `rawDb` because the owner-initiated retire path isn't in a tenant
 * transaction — the clubId scope is still applied in the WHERE clause.
 */
export async function cancelPendingInvoicesForHorse(clubId: string, horseId: string) {
  const result = await rawDb
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
 * where n is the current count of livery invoices for that club + 1. Good
 * enough for human readability; uniqueness is still guaranteed by the
 * (horse_id, period_start) constraint, not by the number itself.
 */
export async function nextLiveryInvoiceNumber(clubId: string) {
  const result = await rawDb
    .select({ count: sql<number>`count(*)::int` })
    .from(liveryInvoices)
    .where(eq(liveryInvoices.clubId, clubId));
  const n = (result[0]?.count ?? 0) + 1;
  return `LIV-${clubId.slice(0, 6)}-${String(n).padStart(5, '0')}`;
}

