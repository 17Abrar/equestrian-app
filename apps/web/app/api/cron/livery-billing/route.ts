import { type NextRequest } from 'next/server';
import {
  findHorsesDueForBilling,
  findHorseBillingAnchor,
  createLiveryInvoiceWithGeneratedNumber,
  findOverdueInvoicesForReminders,
  markInvoiceOverdueAndLogReminder,
  markInvoiceOverdueOnly,
  setInvoiceProviderRef,
  adminGetActivePaymentAccount,
  pruneAuditLog,
  type BillableHorse,
  type PaymentAccountWithCredentials,
} from '@equestrian/db/queries';
import { getTodayDateString } from '@equestrian/shared/utils';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { sendTriggeredEmail, sendTriggeredEmailAsync } from '@/lib/email';
import { logger } from '@/lib/logger';

// Errors that mean the operator needs to do something (reconnect a provider,
// fix an env var) rather than retry — escalate to error level so they page
// instead of getting lost in warn-noise.
const OPERATOR_ACTIONABLE_PAY_ERROR_CODES = new Set([
  'ACCOUNT_NOT_CONNECTED',
  'AUTH_FAILED',
  'PROVIDER_NOT_CONFIGURED',
  'MISSING_CREDENTIALS',
]);
import { errorResponse, successResponse, requireCronSecret } from '@/lib/api-utils';
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
  // Audit F-21 (2026-05-06): centralized cron-secret guard. The
  // helper performs the same constant-time compare + length-padding +
  // structured logging the inline check did, but a missing call shows
  // up immediately on any new cron route.
  const unauthorized = await requireCronSecret(request, 'livery_cron');
  if (unauthorized) return unauthorized;

  // UTC `today` is used as the SQL upper bound on candidates — it's a
  // conservative filter that catches every horse/invoice whose club-local
  // today is at or past the due/start date. The cron then filters per club
  // using `getTodayDateString(club.timezone)` so non-GCC clubs don't bill a
  // calendar day early/late (audit G-3). Rolling at 02:00 UTC means most
  // GCC clubs see a same-day match; Pacific clubs see their local today
  // resolve correctly via the JS filter.
  const utcToday = new Date().toISOString().slice(0, 10);

  // Top-level try/catch so an unexpected throw in issueDueInvoices /
  // sendReminders surfaces through the structured logger and reaches
  // Sentry via the alert pipeline. Without this, an uncaught exception
  // bubbles out of the route, the scheduled() wrapper logs raw
  // `cron_scheduled_non_ok` to Cloudflare's tail (no Sentry tag), and
  // the operator misses the alert — see audit H-6. Per-iteration
  // catches inside the helpers already report their own row failures;
  // this guard catches everything else.
  try {
    const issued = await issueDueInvoices(utcToday);
    const reminded = await sendReminders(utcToday);

    // Audit F-9: piggyback on the daily cron to prune old audit_log rows
    // (90-day retention, capped at 5000 rows per run so a sustained
    // backlog won't blow the wall-clock budget). Wrapped in a separate
    // catch so a failure here doesn't suppress the issuance + reminder
    // result the operator actually cares about.
    let auditPruned = 0;
    try {
      const result = await pruneAuditLog();
      auditPruned = result.pruned;
    } catch (err) {
      logger.warn('audit_log_prune_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('livery_cron_completed', {
      utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      remindersSent: reminded.sent,
      remindersSkipped: reminded.skipped,
      auditLogPruned: auditPruned,
    });

    return successResponse({
      date: utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      remindersSent: reminded.sent,
      remindersSkipped: reminded.skipped,
      auditLogPruned: auditPruned,
    });
  } catch (err) {
    logger.error('livery_cron_failed', {
      utcToday,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('CRON_FAILED', 'Cron run failed', 500);
  }
}

// Audit MED-6 (2026-05-05): GET surface dropped. `worker-entry.mjs`
// invokes this with POST + the `x-cron-secret` HEADER. A GET twin
// invited operators to put the secret in the URL ("?cron-secret=…")
// — which would land in Cloudflare access logs, browser history,
// and proxy intermediaries. Header-only.

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
  /**
   * Opaque reference string that lands in the provider's `bookingId`
   * metadata + the human-readable description. For fresh invoices this is
   * the period start (YYYY-MM-DD); for reminders we don't carry that, so
   * the invoice number is passed instead. The adapter treats it as a
   * blind string — the format is only meaningful when the value reaches
   * an operator reading provider logs.
   */
  reference: string;
  idempotencyKey: string;
}): Promise<PayIntentResult | null> {
  try {
    const adapter = getAdapter(args.account.provider);
    const hostedFn = adapter.createHostedCheckout ?? adapter.createPayment;
    const result = await hostedFn.call(adapter, {
      account: args.account,
      amountMinorUnits: args.amountMinor,
      currency: args.currency,
      bookingId: `livery:${args.horseId}:${args.reference}`,
      riderId: args.ownerMemberId,
      clubId: args.clubId,
      description: `Livery — ${args.horseName} — ${args.reference}`,
      metadata: {
        resource: 'livery_invoice',
        horseId: args.horseId,
        reference: args.reference,
      },
      // Audit AI-21 — read from env so dev/staging redirects land on the
      // right host. Defaults to cavaliq.com in production via the runtime
      // secret; falls back here only if NEXT_PUBLIC_APP_URL is misconfigured.
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/rider/invoices`,
      idempotencyKey: args.idempotencyKey,
    });

    return {
      provider: args.account.provider,
      providerPaymentId: result.providerPaymentId,
      payLink: result.flow === 'redirect' ? result.paymentUrl : undefined,
    };
  } catch (err) {
    // Operator-actionable failures (provider disconnected, missing/expired
    // credentials, env var unset) won't fix themselves on retry — log at
    // error level so they page. Generic adapter throws stay at warn so a
    // transient provider 5xx during a cron run doesn't wake anyone up.
    const code = err instanceof PaymentProviderError ? err.code : undefined;
    const isOperatorActionable = !!code && OPERATOR_ACTIONABLE_PAY_ERROR_CODES.has(code);
    const fields = {
      horseId: args.horseId,
      clubId: args.clubId,
      provider: args.account.provider,
      code,
      error: err instanceof Error ? err.message : 'unknown',
    };
    if (isOperatorActionable) {
      logger.error('livery_payment_intent_failed', fields);
    } else {
      logger.warn('livery_payment_intent_failed', fields);
    }
    return null;
  }
}

// ─── Invoice generation ───────────────────────────────────────────────

async function issueDueInvoices(utcToday: string): Promise<{ issued: number; skipped: number }> {
  const horses = await findHorsesDueForBilling(utcToday);
  const accountCache: AccountCache = new Map();
  let issued = 0;
  let skipped = 0;

  for (const horse of horses) {
    try {
      // Per-club today — non-UTC zones see this resolve to a different
      // calendar date than `utcToday`. The SQL filter over-fetches by up
      // to 24h; we trim here.
      const clubToday = getTodayDateString(horse.clubTimezone);
      if (horse.liveryStartDate > clubToday) {
        skipped += 1;
        continue;
      }
      const anchor = await findHorseBillingAnchor(horse.horseId);
      const period = nextBillingPeriod(horse, anchor, clubToday);
      if (!period) {
        skipped += 1;
        continue;
      }

      // Number is allocated atomically inside createLiveryInvoiceWith
      // GeneratedNumber so a concurrent run can't mint a duplicate (G-4).

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
            reference: period.periodStart,
            idempotencyKey: `livery:${horse.horseId}:${period.periodStart}`,
          })
        : null;

      const invoice = await createLiveryInvoiceWithGeneratedNumber({
        clubId: horse.clubId,
        horseId: horse.horseId,
        ownerMemberId: horse.ownerMemberId,
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
            invoiceNumber: invoice.invoiceNumber,
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

async function sendReminders(utcToday: string): Promise<{ sent: number; skipped: number }> {
  const invoices = await findOverdueInvoicesForReminders(utcToday);
  const accountCache: AccountCache = new Map();
  let sent = 0;
  let skipped = 0;

  for (const inv of invoices) {
    // Resolve "today" in the invoice's own club timezone — for non-UTC
    // zones, `utcToday` may be one calendar day ahead/behind, leading to
    // reminder slots being skipped or doubled. See audit G-3.
    const clubToday = getTodayDateString(inv.clubTimezone);
    if (inv.dueDate > clubToday) {
      skipped += 1;
      continue;
    }
    const daysOverdue = daysBetween(inv.dueDate, clubToday);
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
          reference: inv.invoiceNumber,
          idempotencyKey: `livery:${inv.invoiceId}:reminder:${inv.reminderCount + 1}`,
        });
        if (refreshed) {
          await setInvoiceProviderRef(
            inv.clubId,
            inv.invoiceId,
            refreshed.provider,
            refreshed.providerPaymentId,
            refreshed.payLink,
          );
          payLink = refreshed.payLink ?? payLink;
        }
      }

      // Send the email FIRST and only increment reminder_count on a
      // successful send. The previous order incremented before sending, so a
      // transient Resend outage on day 7 would burn the day-7 reminder slot
      // — the next cron pass keys off reminder_count and would jump straight
      // to the day-14 cadence, leaving the owner without the day-7 nudge.
      // Synchronous send (sendTriggeredEmail, not sendTriggeredEmailAsync) so
      // failures throw and we can skip the increment.
      //
      // Owners with no email on file get a one-shot `pending → overdue`
      // status flip (no counter bump) so a future email patch resumes the
      // 7/14/30-day cadence from scratch — see audit G-2. Without this
      // fix, three reminder slots got burned on null-email rows and the
      // invoice went permanently silent even after the admin added a
      // contact address.
      if (inv.ownerEmail) {
        await sendTriggeredEmail({
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
        await markInvoiceOverdueAndLogReminder(inv.clubId, inv.invoiceId);
        sent += 1;
      } else {
        await markInvoiceOverdueOnly(inv.clubId, inv.invoiceId);
        skipped += 1;
      }
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
