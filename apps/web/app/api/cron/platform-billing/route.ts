import { type NextRequest } from 'next/server';
import {
  findClubsDueForBilling,
  findClubBillingAnchor,
  createPlatformInvoiceWithGeneratedNumber,
  findOverduePlatformInvoicesForReminders,
  markPlatformInvoiceOverdueAndLogReminder,
  markPlatformInvoiceOverdueOnly,
  setPlatformInvoiceProviderRef,
  findClubsWithTrialEndingOn,
  type BillableClub,
} from '@equestrian/db/queries';
import {
  PLATFORM_TIER_PRICES_MINOR,
  PLATFORM_INVOICE_DUE_DAYS,
  MS_PER_DAY,
} from '@equestrian/shared/constants';
import { getTodayDateString } from '@equestrian/shared/utils';
import {
  createPlatformPaymentIntent,
  PlatformZiinaError,
} from '@/lib/billing/platform-ziina';
import { sendEmail, sendEmailAsync } from '@/lib/email';
import { SubscriptionInvoiceIssued } from '@equestrian/email-templates/subscription-invoice-issued';
import { SubscriptionInvoiceOverdue } from '@equestrian/email-templates/subscription-invoice-overdue';
import { TrialEnding } from '@equestrian/email-templates/trial-ending';
import { errorResponse, successResponse, requireCronSecret } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * Daily Cavaliq → club subscription billing cron.
 *
 * For every club that's past its trial and on a paid tier, issues a
 * monthly invoice on the club's billing anniversary (anchored to
 * `clubs.trial_ends_at`). The cron runs alongside the livery cron at
 * 02:00 UTC; both are dispatched from `worker-entry.mjs`'s scheduled()
 * handler, gated by the same `CRON_SECRET`.
 *
 * MVP scope — issuance only. Reminder cadence (7/14/30 day past-due
 * emails) and auto-cancel-after-30-days-overdue are deferred. Clubs see
 * outstanding invoices in Settings → Subscription and pay via the
 * Ziina hosted page link the cron generates.
 *
 * Idempotent: the `(club_id, period_start)` uniqueness constraint on
 * `platform_subscription_invoices` makes double-running on the same UTC
 * day a no-op — the second run sees `onConflictDoNothing` short-circuit
 * and reports it as `skipped`.
 */
export async function POST(request: NextRequest) {
  // Audit F-21 (2026-05-06): centralized cron-secret guard.
  const unauthorized = await requireCronSecret(request, 'platform_billing_cron');
  if (unauthorized) return unauthorized;

  // Audit F-15 (2026-05-06): see livery cron for rationale.
  logger.info('platform_billing_cron_started');

  const utcToday = new Date().toISOString().slice(0, 10);

  try {
    // Three independent passes; failures in one don't block the others.
    // Order matters less than independence — issuance creates new
    // invoices, reminders chase old ones, trial-ending nudges are
    // pre-bill heads-ups.
    const issued = await issueDuePlatformInvoices(utcToday);
    const reminders = await sendPlatformReminders(utcToday);
    const trialNudges = await sendTrialEndingNudges(utcToday);

    logger.info('platform_billing_cron_completed', {
      utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      clubsConsidered: issued.considered,
      remindersSent: reminders.sent,
      remindersSkipped: reminders.skipped,
      trialNudgesSent: trialNudges.sent,
      trialNudgesSkipped: trialNudges.skipped,
    });

    return successResponse({
      date: utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      clubsConsidered: issued.considered,
      remindersSent: reminders.sent,
      remindersSkipped: reminders.skipped,
      trialNudgesSent: trialNudges.sent,
      trialNudgesSkipped: trialNudges.skipped,
    });
  } catch (err) {
    logger.error('platform_billing_cron_failed', {
      utcToday,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('CRON_FAILED', 'Cron run failed', 500);
  }
}

// Audit MED-6 (2026-05-05): GET surface dropped — worker-entry uses
// POST + header. See livery-billing/route.ts for rationale.

// ─── Issuance ─────────────────────────────────────────────────────────

async function issueDuePlatformInvoices(
  utcToday: string,
): Promise<{ issued: number; skipped: number; considered: number }> {
  const clubs = await findClubsDueForBilling(utcToday);
  let issued = 0;
  let skipped = 0;

  for (const club of clubs) {
    try {
      // Resolve "today" in the club's own timezone — non-UTC clubs see
      // the SQL filter over-fetch by up to a day, so we trim here.
      const clubToday = getTodayDateString(club.clubTimezone);

      // 'trial' tier should be filtered out by the SQL clause but
      // belt-and-braces here in case the tier got out of sync with status.
      if (club.tier === 'trial') {
        skipped += 1;
        continue;
      }

      const anchor = await findClubBillingAnchor(club.clubId);
      const period = nextPlatformBillingPeriod(club, anchor, clubToday);
      if (!period) {
        skipped += 1;
        continue;
      }

      const amountMinor = PLATFORM_TIER_PRICES_MINOR[club.tier];
      // A misconfigured tier (e.g. `trial` slipping through) yields 0 —
      // refuse to issue a 0-amount invoice, which Ziina would also reject
      // (200 fils minimum). Skip with a log so an operator notices.
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
        logger.warn('platform_billing_zero_amount_skip', {
          clubId: club.clubId,
          tier: club.tier,
          amountMinor,
        });
        skipped += 1;
        continue;
      }

      const dueDate = addDays(period.periodStart, PLATFORM_INVOICE_DUE_DAYS);
      const idempotencyKey = `platform:${club.clubId}:${period.periodStart}`;

      // Generate the Ziina pay-link first so the invoice carries the
      // link from the moment it's created. If Ziina is unreachable the
      // invoice is still issued (admin can pay later via Settings →
      // Subscription, which calls `setPlatformInvoiceProviderRef` to
      // attach a fresh link on demand). Mirrors the livery pattern.
      const payIntent = await createPayIntentForInvoice({
        clubId: club.clubId,
        clubName: club.clubName,
        amountMinor,
        currency: club.clubCurrency,
        idempotencyKey,
        periodStart: period.periodStart,
      });

      const invoice = await createPlatformInvoiceWithGeneratedNumber({
        clubId: club.clubId,
        tier: club.tier,
        amountMinorUnits: amountMinor,
        currency: club.clubCurrency,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate,
        paymentProvider: payIntent ? 'ziina_platform' : undefined,
        providerPaymentId: payIntent?.providerPaymentId,
        payLink: payIntent?.payLink,
      });

      if (!invoice) {
        // (club_id, period_start) idempotency conflict — a concurrent
        // run already issued this. Treat as skipped (not an error).
        skipped += 1;
        continue;
      }

      issued += 1;

      // Email the club admin with the pay link. Goes out via
      // sendEmailAsync (un-gated by notification preferences — clubs
      // can't opt out of receiving their own bill).
      if (club.clubEmail) {
        sendEmailAsync({
          to: club.clubEmail,
          subject: `Cavaliq subscription invoice — ${invoice.invoiceNumber}`,
          template: SubscriptionInvoiceIssued({
            recipientName: club.clubName,
            clubName: club.clubName,
            invoiceNumber: invoice.invoiceNumber,
            tier: club.tier,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            amountMinorUnits: amountMinor,
            currency: club.clubCurrency,
            dueDate,
            payLink: payIntent?.payLink,
          }),
        });
      } else {
        // No `clubs.email` on file — the operator added the club
        // manually and skipped the contact email. Surface so they can
        // reach out to set it.
        logger.warn('platform_billing_no_club_email', {
          clubId: club.clubId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        });
      }
    } catch (err) {
      logger.error('platform_billing_invoice_issue_failed', {
        clubId: club.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      skipped += 1;
    }
  }

  return { issued, skipped, considered: clubs.length };
}

interface PayIntentResult {
  providerPaymentId: string;
  payLink: string;
}

/**
 * Issues the Ziina platform payment intent for a fresh invoice. Returns
 * `null` (not throws) on adapter errors — the cron still issues the
 * invoice in that case, and the admin can regenerate the pay link from
 * the dashboard. Operator-actionable failures (auth, missing key) escalate
 * to error level so they page; transient adapter throws stay at warn.
 */
async function createPayIntentForInvoice(args: {
  clubId: string;
  clubName: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  periodStart: string;
}): Promise<PayIntentResult | null> {
  try {
    const result = await createPlatformPaymentIntent({
      amountMinorUnits: args.amountMinor,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      message: `Cavaliq subscription — ${args.clubName} — ${args.periodStart}`,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/settings/subscription`,
    });
    return {
      providerPaymentId: result.providerPaymentId,
      payLink: result.paymentUrl,
    };
  } catch (err) {
    const code = err instanceof PlatformZiinaError ? err.code : undefined;
    const isOperatorActionable =
      code === 'PROVIDER_NOT_CONFIGURED' || code === 'AUTH_FAILED';
    const fields = {
      clubId: args.clubId,
      code,
      error: err instanceof Error ? err.message : 'unknown',
    };
    if (isOperatorActionable) {
      logger.error('platform_billing_pay_intent_failed', fields);
    } else {
      logger.warn('platform_billing_pay_intent_failed', fields);
    }
    return null;
  }
}

// ─── Period math ──────────────────────────────────────────────────────

interface NextPeriod {
  periodStart: string;
  periodEnd: string;
}

/**
 * Returns the next unbilled monthly period for a club, or null if today
 * hasn't reached the next anchor. The first period anchors to
 * `trial_ends_at`; subsequent periods step forward in monthly increments.
 *
 * "Today" is the club's local today, not UTC — bills land on the same
 * calendar day every month for the club, regardless of where Cloudflare
 * happens to fire the cron.
 */
function nextPlatformBillingPeriod(
  club: BillableClub,
  anchor: { periodStart: string; periodEnd: string } | null,
  today: string,
): NextPeriod | null {
  // Anchor: the trial_ends_at date (YYYY-MM-DD), or one month after the
  // last billed period.
  const trialEndsAtIso = club.trialEndsAt.toISOString().slice(0, 10);
  const startBase = anchor ? addMonths(anchor.periodStart, 1) : trialEndsAtIso;

  // Period hasn't started yet — wait.
  if (startBase > today) return null;

  // period_end is inclusive: the day before the NEXT period would start.
  const endExclusive = addMonths(startBase, 1);
  const periodEnd = addDays(endExclusive, -1);

  return { periodStart: startBase, periodEnd };
}

// ─── Reminders (Round 6.1) ───────────────────────────────────────────
//
// Mirrors the livery-billing reminder cadence (audit G-2 / G-13 patterns)
// at the platform-billing layer. Three reminder slots at 7 / 14 / 30 days
// past the invoice's due date. The day-30 email's copy escalates and
// warns about subscription suspension; actual suspension is a manual
// operator decision (not auto, see Cavaliq-internal admin tooling).

const PLATFORM_REMINDER_THRESHOLDS = [7, 14, 30] as const;

async function sendPlatformReminders(
  utcToday: string,
): Promise<{ sent: number; skipped: number }> {
  const invoices = await findOverduePlatformInvoicesForReminders(utcToday);
  let sent = 0;
  let skipped = 0;

  for (const inv of invoices) {
    try {
      // Resolve "today" in the club's own timezone — UTC `utcToday` may
      // be one calendar day off for non-UTC clubs at the day boundary,
      // leading to a reminder slot being skipped or doubled. Mirrors
      // livery audit G-3.
      const clubToday = getTodayDateString(inv.clubTimezone);
      if (inv.dueDate > clubToday) {
        skipped += 1;
        continue;
      }
      const daysOverdue = daysBetween(inv.dueDate, clubToday);
      if (daysOverdue < PLATFORM_REMINDER_THRESHOLDS[0]) {
        skipped += 1;
        continue;
      }

      const nextThreshold = PLATFORM_REMINDER_THRESHOLDS[inv.reminderCount];
      if (nextThreshold === undefined) {
        // Past the day-30 reminder — the cadence stops here. Cavaliq-
        // internal review takes over for stragglers.
        skipped += 1;
        continue;
      }
      if (daysOverdue < nextThreshold) {
        skipped += 1;
        continue;
      }

      // Refresh the pay link before emailing — Ziina hosted-page links
      // expire well before 7 days, so an old link in the reminder is a
      // dead end. The idempotency key includes `reminderCount` so the
      // adapter mints a fresh intent rather than returning a cached one.
      let payLink: string | undefined = inv.payLink ?? undefined;
      try {
        const refreshed = await createPlatformPaymentIntent({
          amountMinorUnits: inv.amountMinorUnits,
          currency: inv.currency,
          idempotencyKey: `platform:${inv.invoiceId}:reminder:${inv.reminderCount + 1}`,
          message: `Cavaliq subscription — ${inv.clubName} — ${inv.invoiceNumber}`,
          returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/settings/subscription`,
        });
        await setPlatformInvoiceProviderRef(
          inv.clubId,
          inv.invoiceId,
          'ziina_platform',
          refreshed.providerPaymentId,
          refreshed.paymentUrl,
        );
        payLink = refreshed.paymentUrl;
      } catch (err) {
        // Ziina unreachable — proceed with the stale link, the admin
        // can regenerate from the dashboard. Operator-actionable
        // failures (auth/missing key) escalate; transient failures stay
        // at warn so they don't page.
        const code = err instanceof PlatformZiinaError ? err.code : undefined;
        const isOperatorActionable =
          code === 'PROVIDER_NOT_CONFIGURED' || code === 'AUTH_FAILED';
        const fields = {
          invoiceId: inv.invoiceId,
          clubId: inv.clubId,
          code,
          error: err instanceof Error ? err.message : 'unknown',
        };
        if (isOperatorActionable) {
          logger.error('platform_reminder_pay_intent_failed', fields);
        } else {
          logger.warn('platform_reminder_pay_intent_failed', fields);
        }
      }

      // Audit F-14 (2026-05-06): claim-first ordering. Mark the
      // invoice + bump reminder_count BEFORE sending, so a partial
      // failure (mark succeeds, email fails or DB error after a
      // successful send) doesn't loop the cron into spamming the club
      // on every subsequent pass. A failed send leaves the threshold
      // unfulfilled (one missed nudge) and operator sees
      // `platform_reminder_email_rejected` to manually re-trigger.
      // Clubs with no email get a one-shot `pending → overdue` status
      // flip with no counter bump.
      if (inv.clubEmail) {
        // CAS on `reminder_count`: see livery-billing/route.ts. A
        // null return means another isolate already bumped the counter
        // and sent (or is sending) the email; skip this pass.
        const claimed = await markPlatformInvoiceOverdueAndLogReminder(
          inv.clubId,
          inv.invoiceId,
          inv.reminderCount,
        );
        if (!claimed) {
          skipped += 1;
          continue;
        }
        const result = await sendEmail({
          to: inv.clubEmail,
          subject:
            daysOverdue >= 30
              ? `Final reminder: Cavaliq subscription overdue (${inv.invoiceNumber})`
              : `Cavaliq subscription overdue — ${inv.invoiceNumber}`,
          template: SubscriptionInvoiceOverdue({
            recipientName: inv.clubName,
            clubName: inv.clubName,
            invoiceNumber: inv.invoiceNumber,
            // The `tier` enum includes 'trial' — but a trialing club
            // shouldn't have a platform invoice in the first place
            // (issuance excludes trial tier). Belt-and-braces: narrow
            // to paid tiers and skip if it slipped through.
            tier:
              inv.tier === 'starter' ||
              inv.tier === 'growing' ||
              inv.tier === 'professional'
                ? inv.tier
                : 'starter',
            amountMinorUnits: inv.amountMinorUnits,
            currency: inv.currency,
            dueDate: inv.dueDate,
            daysOverdue,
            payLink,
          }),
        });
        if (result.sent) {
          sent += 1;
        } else {
          // Email infra rejected (most often `EMAIL_FROM` unset in
          // staging). Threshold already burned per F-14; operator can
          // re-send manually from the resolved error.
          logger.error('platform_reminder_email_rejected', {
            invoiceId: inv.invoiceId,
            clubId: inv.clubId,
            error: result.error,
          });
          skipped += 1;
        }
      } else {
        await markPlatformInvoiceOverdueOnly(inv.clubId, inv.invoiceId);
        skipped += 1;
      }
    } catch (err) {
      logger.error('platform_reminder_send_failed', {
        invoiceId: inv.invoiceId,
        clubId: inv.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      skipped += 1;
    }
  }

  return { sent, skipped };
}

// ─── Trial-ending nudges (Round 6.1) ─────────────────────────────────
//
// Two slots: trial-end-minus-3-days and trial-end-minus-1-day. We don't
// store a per-club "last trial nudge sent" counter — the date-equality
// query naturally dedupes (a trialing club only matches each window
// once on a daily cron). Both nudges are gated on the club having an
// email on file. No `notificationPreferences` toggle: trial-ending is
// a billing-relationship email the admin can't opt out of without
// breaking onboarding visibility.

async function sendTrialEndingNudges(
  utcToday: string,
): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;

  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/settings/subscription`;

  for (const daysOut of [3, 1] as const) {
    const targetDate = addDays(utcToday, daysOut);
    const clubs = await findClubsWithTrialEndingOn(targetDate);

    for (const club of clubs) {
      if (!club.clubEmail || !club.trialEndsAt) {
        // No email = can't reach them; no trialEndsAt = the SQL filter
        // shouldn't have matched (a trialing club always has a trial
        // end date), but belt-and-braces.
        skipped += 1;
        continue;
      }
      // The cron only nudges trialing clubs (the SQL filter enforces
      // `subscription_status = 'trialing'`); a club that already
      // upgraded mid-trial gets the regular subscription-invoice-issued
      // email instead.
      const tier =
        club.tier === 'starter' ||
        club.tier === 'growing' ||
        club.tier === 'professional'
          ? club.tier
          : null;
      const tierPriceMinor = tier ? PLATFORM_TIER_PRICES_MINOR[tier] : null;

      try {
        const result = await sendEmail({
          to: club.clubEmail,
          subject:
            daysOut === 1
              ? `Your Cavaliq trial ends tomorrow`
              : `Your Cavaliq trial ends in ${daysOut} days`,
          template: TrialEnding({
            recipientName: club.clubName,
            clubName: club.clubName,
            daysUntilEnd: daysOut,
            trialEndDate: club.trialEndsAt.toISOString().slice(0, 10),
            selectedTier: tier,
            tierPriceMinor,
            currency: club.clubCurrency,
            settingsUrl,
          }),
        });
        if (result.sent) {
          sent += 1;
        } else {
          logger.warn('trial_ending_email_rejected', {
            clubId: club.clubId,
            daysOut,
            error: result.error,
          });
          skipped += 1;
        }
      } catch (err) {
        logger.error('trial_ending_send_failed', {
          clubId: club.clubId,
          daysOut,
          error: err instanceof Error ? err.message : 'unknown',
        });
        skipped += 1;
      }
    }
  }

  // Suppress unused-import warning when the cron fires only issuance.
  void sendEmailAsync;

  return { sent, skipped };
}

// ─── Date helpers (mirrors livery cron) ──────────────────────────────

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const to = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.floor((to - from) / MS_PER_DAY);
}

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
  // Clamp day-of-month so a club anchored on the 31st still bills on the
  // last day of February (avoids the "Feb 31 → Mar 3" overflow bug).
  const daysInTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, daysInTarget));
  return d.toISOString().slice(0, 10);
}
