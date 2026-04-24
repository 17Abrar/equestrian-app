import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import {
  findHorsesDueForBilling,
  findHorseBillingAnchor,
  createLiveryInvoice,
  nextLiveryInvoiceNumber,
  findOverdueInvoicesForReminders,
  markInvoiceOverdueAndLogReminder,
  setInvoiceProviderRef,
  adminGetActivePaymentAccount,
  type BillableHorse,
  type PaymentAccountWithCredentials,
} from '@equestrian/db/queries';
import { getAdapter } from '@/lib/payments/registry';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { logger } from '@/lib/logger';
import { LiveryInvoiceIssued } from '@equestrian/email-templates/livery-invoice-issued';
import { LiveryInvoiceOverdue } from '@equestrian/email-templates/livery-invoice-overdue';

/**
 * Daily livery billing cron. Two responsibilities:
 *
 * 1. **Issue invoices** for horses whose billing anniversary is today (or
 *    earlier, if a previous run was skipped) and who don't yet have an
 *    invoice for that period.
 * 2. **Send reminders** for pending/overdue invoices past their due date,
 *    stepping through the 7/14/30-day cadence via `reminder_count`. The
 *    reminder path also creates a FRESH payment intent because hosted
 *    checkout links (Stripe Checkout, Ziina payment_intent) expire long
 *    before the 7-day reminder fires.
 *
 * Auth: expects `x-cron-secret` to match `CRON_SECRET`. The worker-entry.mjs
 * wrapper supplies this header when Cloudflare's scheduled() fires.
 *
 * Idempotent: the `(horse_id, period_start)` uniqueness constraint prevents
 * double-billing if the cron runs twice on the same day; reminders guard on
 * `reminder_count` against the 7/14/30-day threshold array.
 */
export async function POST(request: NextRequest) {
  const headerSecret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    logger.error('livery_cron_secret_not_configured');
    return NextResponse.json(
      { success: false, error: { code: 'NOT_CONFIGURED', message: 'CRON_SECRET not set' } },
      { status: 503 },
    );
  }

  // Constant-time compare so an attacker can't learn the secret
  // byte-by-byte via response timing. Length check first — timingSafeEqual
  // throws on length mismatch.
  const provided = Buffer.from(headerSecret ?? '', 'utf8');
  const target = Buffer.from(expected, 'utf8');
  const secretOk =
    provided.length === target.length && timingSafeEqual(provided, target);
  if (!secretOk) {
    logger.warn('livery_cron_bad_secret');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Bad cron secret' } },
      { status: 401 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const issued = await issueDueInvoices(today);
  const reminded = await sendReminders(today);

  logger.info('livery_cron_completed', {
    today,
    invoicesIssued: issued.issued,
    invoicesSkipped: issued.skipped,
    remindersSent: reminded.sent,
    remindersSkipped: reminded.skipped,
  });

  return NextResponse.json({
    success: true,
    data: {
      date: today,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      remindersSent: reminded.sent,
      remindersSkipped: reminded.skipped,
    },
  });
}

// GET mirrors POST for wiring variants that prefer GET (some cron wrappers).
export const GET = POST;

// ─── Shared — payment intent + adapter cache ─────────────────────────

interface PayIntentResult {
  provider: string;
  providerPaymentId: string;
  payLink?: string;
}

// Cache active payment accounts by clubId for the duration of the cron run
// so we don't re-fetch + re-decrypt credentials for every invoice from the
// same club.
type AccountCache = Map<string, PaymentAccountWithCredentials | null>;

async function getAccountCached(
  clubId: string,
  cache: AccountCache,
): Promise<PaymentAccountWithCredentials | null> {
  if (cache.has(clubId)) return cache.get(clubId)!;
  const account = await adminGetActivePaymentAccount(clubId);
  cache.set(clubId, account);
  return account;
}

/**
 * Creates a payment intent / hosted checkout for a livery invoice. Returns
 * `null` if the club has no active payment provider OR the adapter threw —
 * caller's job to handle a missing pay link (invoice still ships, admin
 * arranges payment off-platform).
 *
 * `idempotencyKey` varies: for a fresh invoice it's period-scoped; for a
 * reminder it's attempt-scoped so each regeneration is a new intent.
 */
async function createPayIntent(args: {
  account: PaymentAccountWithCredentials;
  amountMinor: number;
  currency: string;
  horseId: string;
  horseName: string;
  ownerMemberId: string;
  clubId: string;
  periodStart: string;
  idempotencyKey: string;
}): Promise<PayIntentResult | null> {
  try {
    const adapter = getAdapter(args.account.provider);
    const hostedFn = adapter.createHostedCheckout ?? adapter.createPayment;
    const result = await hostedFn.call(adapter, {
      account: args.account,
      amountMinorUnits: args.amountMinor,
      currency: args.currency,
      bookingId: `livery:${args.horseId}:${args.periodStart}`,
      riderId: args.ownerMemberId,
      clubId: args.clubId,
      description: `Livery — ${args.horseName} — ${args.periodStart}`,
      metadata: {
        resource: 'livery_invoice',
        horseId: args.horseId,
        period: args.periodStart,
      },
      returnUrl: 'https://cavaliq.com/rider/invoices',
      idempotencyKey: args.idempotencyKey,
    });

    return {
      provider: args.account.provider,
      providerPaymentId: result.providerPaymentId,
      payLink: result.flow === 'redirect' ? result.paymentUrl : undefined,
    };
  } catch (err) {
    logger.warn('livery_payment_intent_failed', {
      horseId: args.horseId,
      clubId: args.clubId,
      provider: args.account.provider,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

// ─── Invoice generation ───────────────────────────────────────────────

async function issueDueInvoices(today: string): Promise<{ issued: number; skipped: number }> {
  const horses = await findHorsesDueForBilling(today);
  const accountCache: AccountCache = new Map();
  let issued = 0;
  let skipped = 0;

  for (const horse of horses) {
    try {
      const anchor = await findHorseBillingAnchor(horse.horseId);
      const period = nextBillingPeriod(horse, anchor, today);
      if (!period) {
        skipped += 1;
        continue;
      }

      const invoiceNumber = await nextLiveryInvoiceNumber(horse.clubId);

      // Amount at time of invoice — snapshotted so a later fee change doesn't
      // retro-alter past invoices.
      const amountMinor = horse.monthlyLiveryFeeMinor;

      // Due date = period_start + 7 days. Configurable later on club settings.
      const dueDate = addDays(period.periodStart, 7);

      const account = await getAccountCached(horse.clubId, accountCache);
      const payIntent = account
        ? await createPayIntent({
            account,
            amountMinor,
            currency: horse.clubCurrency,
            horseId: horse.horseId,
            horseName: horse.horseName,
            ownerMemberId: horse.ownerMemberId,
            clubId: horse.clubId,
            periodStart: period.periodStart,
            idempotencyKey: `livery:${horse.horseId}:${period.periodStart}`,
          })
        : null;

      const invoice = await createLiveryInvoice({
        clubId: horse.clubId,
        horseId: horse.horseId,
        ownerMemberId: horse.ownerMemberId,
        invoiceNumber,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        amountMinorUnits: amountMinor,
        currency: horse.clubCurrency,
        dueDate,
        paymentProvider: payIntent?.provider,
        providerPaymentId: payIntent?.providerPaymentId,
        payLink: payIntent?.payLink,
      });

      if (!invoice) {
        // Conflict — another run already created this invoice. Treat as
        // skipped, not an error.
        skipped += 1;
        continue;
      }

      issued += 1;

      if (horse.ownerEmail) {
        sendTriggeredEmailAsync({
          clubId: horse.clubId,
          trigger: 'livery_invoice_issued',
          to: horse.ownerEmail,
          subject: `Livery invoice — ${horse.horseName} — ${horse.clubName}`,
          template: LiveryInvoiceIssued({
            ownerName: horse.ownerName ?? 'there',
            horseName: horse.horseName,
            clubName: horse.clubName,
            invoiceNumber,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            amountMinorUnits: amountMinor,
            currency: horse.clubCurrency,
            dueDate,
            payLink: payIntent?.payLink,
          }),
        });
      }
    } catch (err) {
      logger.error('livery_invoice_issue_failed', {
        horseId: horse.horseId,
        clubId: horse.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      skipped += 1;
    }
  }

  return { issued, skipped };
}

interface NextPeriod {
  periodStart: string;
  periodEnd: string;
}

/**
 * Calculates the next unissued period for a horse given its livery_start_date
 * and the latest existing invoice (if any). Returns null if the next period
 * hasn't rolled over yet or if the horse's livery has ended.
 */
function nextBillingPeriod(
  horse: BillableHorse,
  anchor: { periodStart: string; periodEnd: string } | null,
  today: string,
): NextPeriod | null {
  const startBase = anchor ? addMonths(anchor.periodStart, 1) : horse.liveryStartDate;

  // If the next period hasn't started yet, don't bill in advance.
  if (startBase > today) return null;

  // If livery has ended before this period starts, skip.
  if (horse.liveryEndDate && startBase > horse.liveryEndDate) return null;

  // period_end is inclusive: the day before next period would start.
  const endExclusive = addMonths(startBase, 1);
  const periodEnd = addDays(endExclusive, -1);

  return { periodStart: startBase, periodEnd };
}

// ─── Reminders ───────────────────────────────────────────────────────

const REMINDER_THRESHOLDS = [7, 14, 30];

async function sendReminders(today: string): Promise<{ sent: number; skipped: number }> {
  const invoices = await findOverdueInvoicesForReminders(today);
  const accountCache: AccountCache = new Map();
  let sent = 0;
  let skipped = 0;

  for (const inv of invoices) {
    const daysOverdue = daysBetween(inv.dueDate, today);
    if (daysOverdue < REMINDER_THRESHOLDS[0]!) {
      skipped += 1;
      continue;
    }

    const nextThreshold = REMINDER_THRESHOLDS[inv.reminderCount];
    if (nextThreshold === undefined) {
      // Past the 30-day reminder — stop sending automated emails.
      skipped += 1;
      continue;
    }

    if (daysOverdue < nextThreshold) {
      skipped += 1;
      continue;
    }

    try {
      // Before emailing, refresh the pay link. Original hosted-checkout
      // sessions expire long before 7 days; if we don't regenerate, owners
      // click a dead link and can't pay from the reminder. The
      // idempotencyKey includes reminderCount so the adapter mints a fresh
      // intent rather than returning a stale one.
      let payLink: string | undefined = inv.payLink ?? undefined;
      const account = await getAccountCached(inv.clubId, accountCache);
      if (account) {
        // Derive a period marker from the invoice number for the intent's
        // bookingId field — we don't have period_start on the reminder row,
        // but the invoice_number uniquely identifies the row and the
        // adapter treats this string opaquely.
        const refreshed = await createPayIntent({
          account,
          amountMinor: inv.amountMinorUnits,
          currency: inv.currency,
          horseId: inv.horseId,
          horseName: inv.horseName,
          ownerMemberId: inv.ownerMemberId,
          clubId: inv.clubId,
          periodStart: inv.invoiceNumber,
          idempotencyKey: `livery:${inv.invoiceId}:reminder:${inv.reminderCount + 1}`,
        });
        if (refreshed) {
          await setInvoiceProviderRef(
            inv.invoiceId,
            refreshed.provider,
            refreshed.providerPaymentId,
            refreshed.payLink,
          );
          payLink = refreshed.payLink ?? payLink;
        }
      }

      await markInvoiceOverdueAndLogReminder(inv.invoiceId);

      if (inv.ownerEmail) {
        sendTriggeredEmailAsync({
          clubId: inv.clubId,
          trigger: 'livery_invoice_overdue',
          to: inv.ownerEmail,
          subject: `Overdue: livery invoice for ${inv.horseName}`,
          template: LiveryInvoiceOverdue({
            ownerName: inv.ownerName ?? 'there',
            horseName: inv.horseName,
            clubName: inv.clubName,
            invoiceNumber: inv.invoiceNumber,
            amountMinorUnits: inv.amountMinorUnits,
            currency: inv.currency,
            dueDate: inv.dueDate,
            daysOverdue,
            payLink,
          }),
        });
      }
      sent += 1;
    } catch (err) {
      logger.error('livery_reminder_send_failed', {
        invoiceId: inv.invoiceId,
        clubId: inv.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      skipped += 1;
    }
  }

  return { sent, skipped };
}

// ─── Date helpers ────────────────────────────────────────────────────

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateIso: string, months: number): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  const targetMonth = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);
  // Clamp the day of month — if we were on the 31st and moved to a shorter
  // month, use the last valid day. Prevents May 31 → July 1 style bugs.
  const daysInTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, daysInTarget));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + 'T00:00:00Z');
  const to = Date.parse(toIso + 'T00:00:00Z');
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}
