import { type NextRequest } from 'next/server';
import {
  claimWebhookEvent,
  findPlatformInvoiceByProviderPayment,
  getPlatformInvoiceForEmail,
  markPlatformInvoicePaid,
  markWebhookEventFailed,
  markWebhookEventPermanentlyFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import {
  verifyPlatformWebhook,
  PlatformWebhookError,
} from '@/lib/billing/platform-ziina';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';
import { sendEmailAsync } from '@/lib/email';
import { SubscriptionPaymentReceived } from '@equestrian/email-templates/subscription-payment-received';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

/**
 * Webhook receiver for Cavaliq's PLATFORM Ziina account — distinct from
 * the per-club Ziina webhook at `/api/webhooks/ziina/[clubId]`. Events
 * that land here come from Cavaliq's own merchant account and pertain
 * to platform_subscription_invoices (clubs paying Cavaliq), not to
 * bookings (riders paying clubs).
 *
 * Configure the webhook in the Ziina business dashboard pointing at
 * `https://cavaliq.com/api/webhooks/ziina-platform` and paste the
 * signing secret as the `PLATFORM_ZIINA_WEBHOOK_SECRET` env / wrangler
 * secret.
 *
 * Audit AI-15 — every rejection path returns identical 401 so an
 * attacker can't probe the webhook config state via response shape.
 *
 * Idempotency: events are claim-then-process via `webhook_events` keyed
 * on `(provider='ziina_platform', event_id)` — the provider string
 * intentionally diverges from per-club `'ziina'` so the two streams have
 * separate dedup namespaces.
 */

const PROVIDER = 'ziina_platform';

const PAID_EVENTS = new Set(['payment_intent.status.updated']);
const HANDLED_EVENTS = new Set<string>([...PAID_EVENTS]);

export async function POST(request: NextRequest) {
  // Audit F-17 (2026-05-07 r4): IP-keyed rate limit + failClosed.
  // Pre-fix the platform-Ziina webhook had no rate limit at all —
  // the URL is publicly known (`cavaliq.com/api/webhooks/ziina-
  // platform`) and any caller could spam it indefinitely; the only
  // bound was the body cap, but the route still pays JSON.parse +
  // HMAC compute on every request. Mirrors the n-genius pattern.
  // Audit r5 F-46 (2026-05-07): IP resolver moved to `lib/request-ip.ts`.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`webhook:ziina_platform:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
    failClosed: true,
  });
  if (!rl.allowed) {
    return new Response('Too many requests', { status: 429 });
  }

  // Audit F-8 (2026-05-06 r3): hoist the signature-header check
  // BEFORE the body read so a forgery without the header pays
  // constant cost — matches the per-club Ziina route's ordering
  // (`/api/webhooks/ziina/[clubId]`). Audit AI-15 — return identical
  // 401 across all rejection paths so the response shape doesn't
  // leak webhook config state.
  const signature = request.headers.get('x-hmac-signature');
  if (!signature) {
    logger.warn('platform_webhook_missing_signature');
    return new Response('Invalid signature', { status: 401 });
  }

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.ziina, PROVIDER);
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }

  let event;
  try {
    event = verifyPlatformWebhook({ body, signatureHeader: signature });
  } catch (err) {
    if (err instanceof PlatformWebhookError) {
      // Operator-actionable cases (NOT_CONFIGURED, INVALID_BODY) escalate.
      // INVALID_SIGNATURE stays at warn so attacker probes don't page.
      if (err.code === 'NOT_CONFIGURED') {
        logger.error('platform_webhook_not_configured');
      } else if (err.code === 'INVALID_BODY') {
        logger.warn('platform_webhook_invalid_body');
      } else {
        logger.warn('platform_webhook_invalid_signature');
      }
    } else {
      logger.error('platform_webhook_verify_failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
    return new Response('Invalid signature', { status: 401 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('platform_webhook_unhandled', { type: event.eventType });
    return new Response('OK', { status: 200 });
  }

  // Two-phase claim. The dedup namespace is `'ziina_platform'` — distinct
  // from per-club `'ziina'` — so a platform event id and a club event id
  // can coexist without colliding.
  const claim = await claimWebhookEvent(PROVIDER, event.eventId);

  if (claim.status === 'already_processed') {
    logger.info('platform_webhook_duplicate', {
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    logger.info('platform_webhook_in_flight', {
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('Processing in progress', { status: 503 });
  }

  if (claim.status === 'permanently_failed') {
    logger.error('webhook_permanently_failed', {
      provider: PROVIDER,
      eventId: event.eventId,
      eventType: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    let permanentFailureReason: string | null = null;
    if (event.status === 'succeeded' && event.providerPaymentId) {
      permanentFailureReason = await applyPaidEvent({
        providerPaymentId: event.providerPaymentId,
        eventCurrency: event.currency,
        eventAmountReceived: event.amountReceivedMinorUnits,
      });
    }
    // Other statuses (pending / requires_action / failed / cancelled) are
    // logged for observability but don't mutate the invoice — the cron
    // will reissue / the admin will retry. We only flip to `paid` on a
    // confirmed completion.

    // Audit LOW (2026-05-05 pass 2): currency-mismatch / underfunded
    // branches inside applyPaidEvent now signal `permanentFailureReason`
    // rather than returning silently. The previous shape called
    // `markWebhookEventProcessed` even though no apply happened — the
    // operator could only spot the gap by tailing logs. Park the dedup
    // row in `permanently_failed` so the alert fires.
    if (permanentFailureReason) {
      await markWebhookEventPermanentlyFailed(
        PROVIDER,
        event.eventId,
        permanentFailureReason,
      );
    } else {
      await markWebhookEventProcessed(PROVIDER, event.eventId);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await markWebhookEventFailed(PROVIDER, event.eventId, message);
    logger.error('platform_webhook_processing_failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      attempt: claim.attempt,
      error: message,
    });
    return new Response('Processing failed', { status: 500 });
  }
}

interface PaidEventArgs {
  providerPaymentId: string;
  eventCurrency: string | undefined;
  eventAmountReceived: number | undefined;
}

/**
 * Audit LOW (2026-05-05 pass 2): returns null on a clean apply, or a
 * human-readable reason string when the event must be parked
 * (`permanently_failed`) instead of silently flipped to `processed`.
 */
async function applyPaidEvent(args: PaidEventArgs): Promise<string | null> {
  const invoice = await findPlatformInvoiceByProviderPayment(
    args.providerPaymentId,
    'ziina_platform',
  );
  if (!invoice) {
    logger.warn('platform_webhook_no_invoice_for_event', {
      providerPaymentId: args.providerPaymentId,
    });
    // Unknown invoice — could be a test event, a Cavaliq-platform
    // payment outside our subscription flow, or genuinely lost. Mark
    // processed (idempotent no-op); operators see the warn log.
    return null;
  }

  // Amount + currency reconciliation. A Ziina event with metadata that
  // doesn't match our invoice could be a spoofed payload OR a stale
  // intent we don't track — either way, refuse to flip the invoice to
  // paid. The signature check above already proved the body is from
  // Cavaliq's account, so this is belt-and-braces against a future
  // multi-account confusion.
  if (
    args.eventCurrency &&
    args.eventCurrency.toUpperCase() !== invoice.currency.toUpperCase()
  ) {
    logger.error('platform_webhook_currency_mismatch', {
      invoiceId: invoice.id,
      clubId: invoice.clubId,
      eventCurrency: args.eventCurrency,
      invoiceCurrency: invoice.currency,
    });
    return `Currency mismatch on platform invoice ${invoice.id}: expected ${invoice.currency}, got ${args.eventCurrency}`;
  }
  if (
    args.eventAmountReceived !== undefined &&
    args.eventAmountReceived < invoice.amountMinorUnits
  ) {
    logger.error('platform_webhook_amount_underfunded', {
      invoiceId: invoice.id,
      clubId: invoice.clubId,
      received: args.eventAmountReceived,
      expected: invoice.amountMinorUnits,
    });
    return `Amount underfunded on platform invoice ${invoice.id}: received ${args.eventAmountReceived} < expected ${invoice.amountMinorUnits}`;
  }
  // Audit F-12 (2026-05-07 r4): symmetric overfund branch. Mirror the
  // booking-flow guard — don't block the apply (the club has paid), but
  // surface the discrepancy so platform finance can refund the difference.
  if (
    args.eventAmountReceived !== undefined &&
    args.eventAmountReceived > invoice.amountMinorUnits
  ) {
    logger.error('platform_webhook_amount_overfunded', {
      invoiceId: invoice.id,
      clubId: invoice.clubId,
      received: args.eventAmountReceived,
      expected: invoice.amountMinorUnits,
      overfundMinor: args.eventAmountReceived - invoice.amountMinorUnits,
    });
  }

  const paidAt = new Date();
  const updated = await markPlatformInvoicePaid(invoice.clubId, invoice.id, {
    paidAt,
    paymentProvider: 'ziina_platform',
    providerPaymentId: args.providerPaymentId,
  });

  if (!updated) {
    // Already terminal (paid / cancelled). Idempotent replay or admin
    // marked it manually paid first — log and move on.
    logger.info('platform_webhook_invoice_already_terminal', {
      invoiceId: invoice.id,
      clubId: invoice.clubId,
      currentStatus: invoice.status,
    });
    return null;
  }

  // Send the receipt email. Fetch the joined view so we know the club's
  // name + email + period info for the template.
  const detail = await getPlatformInvoiceForEmail(invoice.clubId, invoice.id);
  if (detail?.clubEmail) {
    sendEmailAsync({
      to: detail.clubEmail,
      subject: `Payment received — ${detail.invoiceNumber}`,
      template: SubscriptionPaymentReceived({
        recipientName: detail.clubName,
        clubName: detail.clubName,
        invoiceNumber: detail.invoiceNumber,
        tier: detail.tier as 'starter' | 'growing' | 'professional',
        amountMinorUnits: detail.amountMinorUnits,
        currency: detail.currency,
        paidDate: paidAt.toISOString().slice(0, 10),
        periodEnd: detail.periodEnd,
      }),
    });
  }

  logger.info('platform_invoice_paid_from_webhook', {
    invoiceId: invoice.id,
    clubId: invoice.clubId,
    invoiceNumber: invoice.invoiceNumber,
  });
  return null;
}
