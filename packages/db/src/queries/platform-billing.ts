import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, rawDb, writeTransaction } from '../index';
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
    )
    // Bounded run-time so the cron can't hit Workers' wall-clock budget
    // on a sustained backlog. Mirrors the established pattern at
    // `findOverdueInvoicesForReminders` (200) and the livery
    // `findHorsesDueForBilling` (1000). 500 is enough for one pass at
    // current scale and any future ramp; operators monitoring
    // `cron_capacity_hit` should bump this if it pegs.
    .limit(500);

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
  // Audit HIGH-10 (2026-05-05): per-club Postgres advisory transaction
  // lock around COUNT+INSERT — same pattern as the livery counterpart.
  return writeTransaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('platform_invoice_number:' || ${input.clubId}))`,
    );
    const MAX_ATTEMPTS = 8;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const result = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(platformSubscriptionInvoices)
        .where(eq(platformSubscriptionInvoices.clubId, input.clubId));
      const n = (result[0]?.count ?? 0) + 1;
      const invoiceNumber = `PLAT-${input.clubId.slice(0, 6)}-${String(n).padStart(5, '0')}`;
      try {
        const inserted = await tx
          .insert(platformSubscriptionInvoices)
          .values({
            clubId: input.clubId,
            invoiceNumber,
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
          })
          .onConflictDoNothing({
            target: [
              platformSubscriptionInvoices.clubId,
              platformSubscriptionInvoices.periodStart,
            ],
          })
          .returning();
        return inserted[0] ?? null;
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
        const constraint =
          err && typeof err === 'object' && 'constraint' in err
            ? String((err as { constraint: unknown }).constraint)
            : '';
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
  });
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

/**
 * Set-or-update the provider reference on an existing platform invoice
 * row — used when the cron creates an invoice without a pay link first
 * (Ziina was unreachable) and a follow-up pass attaches one later.
 *
 * Audit F-2 (2026-05-07 r5): CAS guard mirrors `setBookingPaymentRef`
 * and the livery counterpart. The WHERE refuses to overwrite an
 * existing `provider_payment_id` with a different value, so a
 * reminder-regeneration race that fires AFTER the owner paid the prior
 * intent doesn't orphan that intent's webhook resolution.
 */
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
        // Don't overwrite a different intent — reminder regeneration race.
        sql`(${platformSubscriptionInvoices.providerPaymentId} IS NULL OR ${platformSubscriptionInvoices.providerPaymentId} = ${providerPaymentId})`,
        // Don't overwrite a terminal-state row's provider ref.
        inArray(platformSubscriptionInvoices.status, ['pending', 'overdue']),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Round 6.1 reminder cadence — find platform invoices past due that
 * haven't yet hit their next 7/14/30-day reminder threshold. Mirrors
 * livery's `findOverdueInvoicesForReminders` shape so the cron can
 * iterate the same way. The caller filters per-club timezone before
 * stepping the counter (see `apps/web/app/api/cron/platform-billing/route.ts`).
 *
 * Cancelled clubs are excluded — once an operator manually cancels a
 * subscription via the Cavaliq-internal admin tool, the cron stops
 * chasing past invoices. The bound (LIMIT 200) protects against the
 * Worker wallclock budget on a sustained backlog; orderBy
 * `reminderCount ASC` keeps the day-7 nudge from being starved by
 * day-30 stragglers (audit G-13 pattern from livery).
 */
export async function findOverduePlatformInvoicesForReminders(today: string) {
  const rows = await rawDb
    .select({
      invoiceId: platformSubscriptionInvoices.id,
      clubId: platformSubscriptionInvoices.clubId,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      invoiceNumber: platformSubscriptionInvoices.invoiceNumber,
      tier: platformSubscriptionInvoices.tier,
      amountMinorUnits: platformSubscriptionInvoices.amountMinorUnits,
      currency: platformSubscriptionInvoices.currency,
      dueDate: platformSubscriptionInvoices.dueDate,
      payLink: platformSubscriptionInvoices.payLink,
      providerPaymentId: platformSubscriptionInvoices.providerPaymentId,
      lastReminderAt: platformSubscriptionInvoices.lastReminderAt,
      reminderCount: platformSubscriptionInvoices.reminderCount,
      status: platformSubscriptionInvoices.status,
    })
    .from(platformSubscriptionInvoices)
    .innerJoin(clubs, eq(clubs.id, platformSubscriptionInvoices.clubId))
    .where(
      and(
        inArray(platformSubscriptionInvoices.status, ['pending', 'overdue']),
        lte(platformSubscriptionInvoices.dueDate, today),
        // Don't keep chasing a club whose subscription has been
        // cancelled by Cavaliq — the operator already made that call.
        sql`${clubs.subscriptionStatus} <> 'cancelled'`,
        isNull(clubs.deletedAt),
      ),
    )
    .orderBy(
      asc(platformSubscriptionInvoices.reminderCount),
      asc(platformSubscriptionInvoices.dueDate),
    )
    .limit(200);
  return rows;
}

/**
 * One-shot `pending → overdue` flip + reminder counter increment.
 * Used by the cron when a reminder email actually went out (i.e. the
 * club has an email on file). Mirrors livery's
 * `markInvoiceOverdueAndLogReminder`.
 *
 * CAS on `reminder_count`: prevents two concurrent cron isolates from
 * both bumping the counter and both firing the same threshold's email.
 * Caller passes the value it observed in `findOverdueInvoicesForReminders`;
 * a `null` return means another isolate beat us and the caller must
 * skip the send.
 */
export async function markPlatformInvoiceOverdueAndLogReminder(
  clubId: string,
  invoiceId: string,
  expectedReminderCount: number,
) {
  const result = await rawDb
    .update(platformSubscriptionInvoices)
    .set({
      status: 'overdue',
      lastReminderAt: new Date(),
      reminderCount: sql`${platformSubscriptionInvoices.reminderCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformSubscriptionInvoices.id, invoiceId),
        eq(platformSubscriptionInvoices.clubId, clubId),
        eq(platformSubscriptionInvoices.reminderCount, expectedReminderCount),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * `pending → overdue` flip with NO counter bump — used when the club
 * has no email on file (a freshly-created club where the admin hasn't
 * filled in `clubs.email` yet). Bumping the counter would burn the
 * 7/14/30 cadence on rows that never sent anything; this preserves
 * the cadence for when the email is patched in. Idempotent: a second
 * call against an already-overdue row is a no-op (the WHERE filters
 * `status = 'pending'`).
 */
export async function markPlatformInvoiceOverdueOnly(
  clubId: string,
  invoiceId: string,
) {
  const result = await rawDb
    .update(platformSubscriptionInvoices)
    .set({
      status: 'overdue',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformSubscriptionInvoices.id, invoiceId),
        eq(platformSubscriptionInvoices.clubId, clubId),
        eq(platformSubscriptionInvoices.status, 'pending'),
      ),
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Round 6.1 — find clubs whose 14-day trial ends in `daysOut` days
 * (1 or 3). Pass `daysOut` so the SQL filters out rows where the
 * matching `trial_reminder_${daysOut}day_sent_at` column is already
 * set — this is the cheap pre-flight; `markTrialReminderSent` does
 * the actual CAS-guarded claim before the email send (audit pass-2
 * C-1).
 */
export async function findClubsWithTrialEndingOn(
  targetDateIso: string,
  daysOut: 1 | 3,
) {
  const sentColumn =
    daysOut === 1 ? clubs.trialReminder1DaySentAt : clubs.trialReminder3DaySentAt;
  const rows = await rawDb
    .select({
      clubId: clubs.id,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubCurrency: clubs.currency,
      tier: clubs.subscriptionTier,
      subscriptionStatus: clubs.subscriptionStatus,
      trialEndsAt: clubs.trialEndsAt,
    })
    .from(clubs)
    .where(
      and(
        eq(clubs.subscriptionStatus, 'trialing'),
        // `trialEndsAt::date = $targetDateIso`. Postgres CASTs
        // timestamptz → date in the club's stored timezone? No —
        // the cast uses the session timezone (UTC for our cron).
        // For our purposes that's good enough: trial dates are stored
        // as midnight UTC on the trial-end day, so comparing to a
        // YYYY-MM-DD string in UTC matches.
        sql`${clubs.trialEndsAt}::date = ${targetDateIso}::date`,
        isNull(clubs.deletedAt),
        // Audit pass-2 C-1: skip clubs already nudged at this threshold.
        // Cheap pre-flight; `markTrialReminderSent` is the actual
        // race-safe claim.
        isNull(sentColumn),
      ),
    );
  return rows;
}

/**
 * Audit pass-2 (2026-05-09 C-1): CAS-guarded claim of a trial-ending
 * nudge for `(clubId, daysOut)`. Returns true when this caller won
 * the race (the column was NULL and is now `now()`); returns false
 * when another isolate already won (the column was non-null) or the
 * club doesn't exist. Caller sends the email only on `true`.
 *
 * Mirrors the booking-reminder / horse-care-reminder dedup pattern.
 */
export async function markTrialReminderSent(
  clubId: string,
  daysOut: 1 | 3,
): Promise<boolean> {
  const column =
    daysOut === 1 ? clubs.trialReminder1DaySentAt : clubs.trialReminder3DaySentAt;
  const result = await rawDb
    .update(clubs)
    .set({ [daysOut === 1 ? 'trialReminder1DaySentAt' : 'trialReminder3DaySentAt']: new Date() })
    .where(and(eq(clubs.id, clubId), isNull(column)))
    .returning({ id: clubs.id });
  return result.length > 0;
}

/**
 * Companion to `markTrialReminderSent` — clears the timestamp when
 * the email send fails so the next cron pass can re-attempt. Mirrors
 * `unmarkBookingReminderSent` and `unrecordHorseCareReminderSend`.
 */
export async function unmarkTrialReminderSent(
  clubId: string,
  daysOut: 1 | 3,
): Promise<void> {
  const setKey = daysOut === 1 ? 'trialReminder1DaySentAt' : 'trialReminder3DaySentAt';
  await rawDb
    .update(clubs)
    .set({ [setKey]: null })
    .where(eq(clubs.id, clubId));
}

/** Used by the dashboard subscription summary card. Returns the
 *  next-due invoice (pending or overdue, ordered by due date) and
 *  any unpaid total.
 *
 *  Audit r6 F-46 (2026-05-08): belt-and-braces `.limit(100)` to mirror
 *  `getPlatformInvoicesByClub`. Outstanding invoices for one club are
 *  intrinsically bounded (Cavaliq bills monthly; suspension lands well
 *  before 12-24 unpaid invoices accrue), so this is not a DoS surface
 *  — the cap simply makes the bound explicit and consistent with the
 *  sibling list query. */
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
    .orderBy(asc(platformSubscriptionInvoices.dueDate))
    .limit(100);

  return rows;
}
