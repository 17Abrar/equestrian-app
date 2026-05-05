import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, rawDb } from '../index';
import { platformSubscriptionInvoices } from '../schema/platform-subscription-invoices';
import { clubs } from '../schema/clubs';

// ─── Types ────────────────────────────────────────────────────────────

type NewPlatformInvoice = typeof platformSubscriptionInvoices.$inferInsert;

export interface BillableClub {
  clubId: string;
  clubName: string;
  clubEmail: string | null;
  clubTimezone: string;
  clubCurrency: string;
  tier: 'trial' | 'starter' | 'growing' | 'professional';
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  trialEndsAt: Date;
}

/**
 * Returns clubs whose subscription is past trial and may be due for a
 * platform invoice today. The cron filters further per-club using the
 * club's own timezone and the running anchor (period start) — see
 * `nextPlatformBillingPeriod`.
 *
 * The SQL filter is intentionally permissive (UTC `today >= trial_ends_at`)
 * so non-UTC clubs aren't missed at the day boundary. The downstream
 * timezone-aware filter trims false positives.
 *
 * Trial-status and cancelled clubs are excluded — only `active` and
 * `past_due` clubs receive invoices. (Past-due clubs still get billed
 * for the next period; payment-collection on the previous period is the
 * reminder cadence's job.)
 */
export async function findClubsDueForBilling(utcToday: string): Promise<BillableClub[]> {
  const rows = await rawDb
    .select({
      clubId: clubs.id,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubCurrency: clubs.currency,
      tier: clubs.subscriptionTier,
      status: clubs.subscriptionStatus,
      trialEndsAt: clubs.trialEndsAt,
      isActive: clubs.isActive,
      deletedAt: clubs.deletedAt,
    })
    .from(clubs)
    .where(
      and(
        eq(clubs.isActive, true),
        // `IS NULL` filter — only clubs with a real anchor get billed.
        // A club whose Clerk webhook never landed (no trial_ends_at) is
        // skipped silently; the operator has to investigate why the
        // webhook didn't fire.
        sql`${clubs.trialEndsAt} IS NOT NULL`,
        sql`${clubs.deletedAt} IS NULL`,
        inArray(clubs.subscriptionStatus, ['active', 'past_due']),
        // Anchor must be at or before today — clubs still in trial have
        // future anchors and are filtered out here.
        sql`${clubs.trialEndsAt} <= ${utcToday}::timestamp + interval '1 day'`,
      ),
    );

  return rows
    .filter(
      (r): r is typeof r & { trialEndsAt: Date } => r.trialEndsAt instanceof Date,
    )
    .map((r) => ({
      clubId: r.clubId,
      clubName: r.clubName,
      clubEmail: r.clubEmail,
      clubTimezone: r.clubTimezone,
      clubCurrency: r.clubCurrency,
      tier: r.tier,
      status: r.status,
      trialEndsAt: r.trialEndsAt,
    }));
}

/**
 * Looks up the most recently billed period for a club. Returns null if
 * no platform invoice exists yet — the next anchor is `trial_ends_at`.
 */
export async function findClubBillingAnchor(clubId: string) {
  const rows = await rawDb
    .select({
      periodStart: platformSubscriptionInvoices.periodStart,
      periodEnd: platformSubscriptionInvoices.periodEnd,
    })
    .from(platformSubscriptionInvoices)
    .where(eq(platformSubscriptionInvoices.clubId, clubId))
    .orderBy(desc(platformSubscriptionInvoices.periodStart))
    .limit(1);

  return rows[0] ?? null;
}

// ─── Invoice issuance ─────────────────────────────────────────────────

interface CreatePlatformInvoiceInput {
  clubId: string;
  invoiceNumber: string;
  tier: 'starter' | 'growing' | 'professional';
  amountMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paymentProvider?: string;
  providerPaymentId?: string;
  payLink?: string;
}

export async function createPlatformInvoice(input: CreatePlatformInvoiceInput) {
  const values: NewPlatformInvoice = {
    clubId: input.clubId,
    invoiceNumber: input.invoiceNumber,
    tier: input.tier,
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    paymentProvider: input.paymentProvider,
    providerPaymentId: input.providerPaymentId,
    payLink: input.payLink,
    status: 'pending',
  };
  const result = await rawDb
    .insert(platformSubscriptionInvoices)
    .values(values)
    .onConflictDoNothing({
      target: [
        platformSubscriptionInvoices.clubId,
        platformSubscriptionInvoices.periodStart,
      ],
    })
    .returning();
  return result[0] ?? null;
}

/**
 * Per-club sequential invoice number. Format: `PLAT-{clubId-prefix}-{n}`.
 * Mirrors the livery numbering scheme; the per-club uniqueness index
 * catches concurrent races and the wrapper retries with a fresh count.
 */
export async function nextPlatformInvoiceNumber(clubId: string) {
  const rows = await rawDb
    .select({ count: sql<number>`count(*)::int` })
    .from(platformSubscriptionInvoices)
    .where(eq(platformSubscriptionInvoices.clubId, clubId));
  const n = (rows[0]?.count ?? 0) + 1;
  return `PLAT-${clubId.slice(0, 6)}-${String(n).padStart(5, '0')}`;
}

type CreatePlatformInvoiceWithoutNumber = Omit<CreatePlatformInvoiceInput, 'invoiceNumber'>;

export async function createPlatformInvoiceWithGeneratedNumber(
  input: CreatePlatformInvoiceWithoutNumber,
): Promise<NonNullable<Awaited<ReturnType<typeof createPlatformInvoice>>> | null> {
  const MAX_ATTEMPTS = 8;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const invoiceNumber = await nextPlatformInvoiceNumber(input.clubId);
    try {
      const invoice = await createPlatformInvoice({ ...input, invoiceNumber });
      return invoice;
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      const constraint =
        err && typeof err === 'object' && 'constraint' in err
          ? String((err as { constraint: unknown }).constraint)
          : '';
      // Only retry on the per-club number-uniqueness collision. Anything
      // else (FK violation, NULL on a notNull column, etc.) is a real
      // bug and should bubble.
      if (
        code === '23505' &&
        constraint === 'platform_subscription_invoices_club_number_unique'
      ) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `createPlatformInvoiceWithGeneratedNumber: exhausted ${MAX_ATTEMPTS} attempts, last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// ─── Lookups ──────────────────────────────────────────────────────────

export async function findPlatformInvoiceByProviderPayment(
  providerPaymentId: string,
  provider: string,
) {
  const rows = await rawDb
    .select({
      id: platformSubscriptionInvoices.id,
      clubId: platformSubscriptionInvoices.clubId,
      invoiceNumber: platformSubscriptionInvoices.invoiceNumber,
      amountMinorUnits: platformSubscriptionInvoices.amountMinorUnits,
      currency: platformSubscriptionInvoices.currency,
      status: platformSubscriptionInvoices.status,
      tier: platformSubscriptionInvoices.tier,
    })
    .from(platformSubscriptionInvoices)
    .where(
      and(
        eq(platformSubscriptionInvoices.providerPaymentId, providerPaymentId),
        eq(platformSubscriptionInvoices.paymentProvider, provider),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Marks a platform invoice paid idempotently. Won't move a terminal
 * `cancelled` invoice back to paid. Returns null when the row was
 * either not found or already in a terminal state — caller's job to
 * decide if that's a no-op or a warning.
 */
export async function markPlatformInvoicePaid(
  clubId: string,
  invoiceId: string,
  paid: { paidAt: Date; paymentProvider?: string; providerPaymentId?: string },
) {
  const result = await rawDb
    .update(platformSubscriptionInvoices)
    .set({
      status: 'paid',
      paidAt: paid.paidAt,
      paymentProvider: paid.paymentProvider,
      providerPaymentId: paid.providerPaymentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformSubscriptionInvoices.id, invoiceId),
        eq(platformSubscriptionInvoices.clubId, clubId),
        inArray(platformSubscriptionInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

export async function getPlatformInvoicesByClub(clubId: string, limit = 24) {
  const rows = await db
    .select({
      id: platformSubscriptionInvoices.id,
      invoiceNumber: platformSubscriptionInvoices.invoiceNumber,
      tier: platformSubscriptionInvoices.tier,
      amountMinorUnits: platformSubscriptionInvoices.amountMinorUnits,
      currency: platformSubscriptionInvoices.currency,
      periodStart: platformSubscriptionInvoices.periodStart,
      periodEnd: platformSubscriptionInvoices.periodEnd,
      status: platformSubscriptionInvoices.status,
      dueDate: platformSubscriptionInvoices.dueDate,
      paidAt: platformSubscriptionInvoices.paidAt,
      payLink: platformSubscriptionInvoices.payLink,
      createdAt: platformSubscriptionInvoices.createdAt,
    })
    .from(platformSubscriptionInvoices)
    .where(eq(platformSubscriptionInvoices.clubId, clubId))
    .orderBy(desc(platformSubscriptionInvoices.periodStart))
    .limit(limit);

  return rows;
}

/** Pulled by the email-issued / payment-received flows after the cron / webhook
 *  finishes the row update — returns the join data the template needs. */
export async function getPlatformInvoiceForEmail(clubId: string, invoiceId: string) {
  const rows = await rawDb
    .select({
      id: platformSubscriptionInvoices.id,
      invoiceNumber: platformSubscriptionInvoices.invoiceNumber,
      tier: platformSubscriptionInvoices.tier,
      amountMinorUnits: platformSubscriptionInvoices.amountMinorUnits,
      currency: platformSubscriptionInvoices.currency,
      periodStart: platformSubscriptionInvoices.periodStart,
      periodEnd: platformSubscriptionInvoices.periodEnd,
      dueDate: platformSubscriptionInvoices.dueDate,
      payLink: platformSubscriptionInvoices.payLink,
      paidAt: platformSubscriptionInvoices.paidAt,
      clubName: clubs.name,
      clubEmail: clubs.email,
    })
    .from(platformSubscriptionInvoices)
    .innerJoin(clubs, eq(platformSubscriptionInvoices.clubId, clubs.id))
    .where(
      and(
        eq(platformSubscriptionInvoices.id, invoiceId),
        eq(platformSubscriptionInvoices.clubId, clubId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Set-or-update the provider reference on an existing platform invoice
 *  row — used when the cron creates an invoice without a pay link first
 *  (Ziina was unreachable) and a follow-up pass attaches one later. */
export async function setPlatformInvoiceProviderRef(
  clubId: string,
  invoiceId: string,
  provider: string,
  providerPaymentId: string,
  payLink: string | undefined,
) {
  const result = await rawDb
    .update(platformSubscriptionInvoices)
    .set({
      paymentProvider: provider,
      providerPaymentId,
      payLink: payLink ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformSubscriptionInvoices.id, invoiceId),
        eq(platformSubscriptionInvoices.clubId, clubId),
        // Don't overwrite a terminal-state row's provider ref.
        inArray(platformSubscriptionInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/** Used by the dashboard subscription summary card. Returns the
 *  next-due invoice (pending or overdue, ordered by due date) and
 *  any unpaid total. */
export async function getOutstandingPlatformInvoices(clubId: string) {
  const rows = await db
    .select({
      id: platformSubscriptionInvoices.id,
      invoiceNumber: platformSubscriptionInvoices.invoiceNumber,
      amountMinorUnits: platformSubscriptionInvoices.amountMinorUnits,
      currency: platformSubscriptionInvoices.currency,
      dueDate: platformSubscriptionInvoices.dueDate,
      status: platformSubscriptionInvoices.status,
      payLink: platformSubscriptionInvoices.payLink,
      tier: platformSubscriptionInvoices.tier,
      periodStart: platformSubscriptionInvoices.periodStart,
      periodEnd: platformSubscriptionInvoices.periodEnd,
    })
    .from(platformSubscriptionInvoices)
    .where(
      and(
        eq(platformSubscriptionInvoices.clubId, clubId),
        inArray(platformSubscriptionInvoices.status, ['pending', 'overdue']),
      ),
    )
    .orderBy(asc(platformSubscriptionInvoices.dueDate));

  return rows;
}
