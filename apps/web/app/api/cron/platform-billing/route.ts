import { timingSafeEqual } from 'node:crypto';
import { type NextRequest } from 'next/server';
import {
  findClubsDueForBilling,
  findClubBillingAnchor,
  createPlatformInvoiceWithGeneratedNumber,
  type BillableClub,
} from '@equestrian/db/queries';
import {
  PLATFORM_TIER_PRICES_MINOR,
  PLATFORM_INVOICE_DUE_DAYS,
} from '@equestrian/shared/constants';
import { getTodayDateString } from '@equestrian/shared/utils';
import {
  createPlatformPaymentIntent,
  PlatformZiinaError,
} from '@/lib/billing/platform-ziina';
import { sendEmailAsync } from '@/lib/email';
import { SubscriptionInvoiceIssued } from '@equestrian/email-templates/subscription-invoice-issued';
import { errorResponse, successResponse } from '@/lib/api-utils';
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
  const headerSecret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    logger.error('platform_billing_cron_secret_not_configured');
    return errorResponse('NOT_CONFIGURED', 'CRON_SECRET not set', 503);
  }

  // Constant-time compare with length-padding so a wrong-length header
  // pays the full O(n) compare and doesn't leak the secret length via
  // response timing — same pattern as the livery cron (audit B-15).
  const provided = Buffer.from(headerSecret ?? '', 'utf8');
  const target = Buffer.from(expected, 'utf8');
  const sameLength = provided.length === target.length;
  const padded = sameLength ? provided : Buffer.alloc(target.length);
  const compareResult = timingSafeEqual(padded, target);
  const secretOk = sameLength && compareResult;
  if (!secretOk) {
    logger.warn('platform_billing_cron_bad_secret', {
      headerPresent: headerSecret !== null,
      providedLength: provided.length,
      ip:
        request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request.headers.get('x-real-ip') ??
        'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('UNAUTHORIZED', 'Bad cron secret', 401);
  }

  const utcToday = new Date().toISOString().slice(0, 10);

  try {
    const issued = await issueDuePlatformInvoices(utcToday);

    logger.info('platform_billing_cron_completed', {
      utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      clubsConsidered: issued.considered,
    });

    return successResponse({
      date: utcToday,
      invoicesIssued: issued.issued,
      invoicesSkipped: issued.skipped,
      clubsConsidered: issued.considered,
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

// Some cron wrappers prefer GET. Mirror livery's both-verbs surface.
export const GET = POST;

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

// ─── Date helpers (mirrors livery cron) ──────────────────────────────

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
