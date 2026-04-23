import { type NextRequest } from 'next/server';
import { stripeAdapter } from '@/lib/payments/stripe';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * Platform-level Stripe Connect webhook. One endpoint services every
 * connected club; `event.account` tells us which connected account fired
 * the event, and we look up the club by that.
 *
 * Register this URL in the Stripe Dashboard under Developers > Webhooks
 * on the PLATFORM account (not each connected account) and enable the
 * events listed under `HANDLED_EVENTS` below.
 */

const PAID_EVENTS = new Set(['payment_intent.succeeded']);
const FAILED_EVENTS = new Set([
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);
const REFUND_EVENTS = new Set(['charge.refunded', 'charge.refund.updated']);

const HANDLED_EVENTS = new Set<string>([
  ...PAID_EVENTS,
  ...FAILED_EVENTS,
  ...REFUND_EVENTS,
]);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    logger.warn('stripe_webhook_missing_signature');
    return new Response('Missing signature', { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('stripe_webhook_secret_missing');
    return new Response('Not configured', { status: 503 });
  }

  let event;
  try {
    event = await stripeAdapter.verifyWebhook({
      body,
      signatureHeader: signature,
      webhookSecret,
    });
  } catch (err) {
    if (err instanceof PaymentProviderError && err.code === 'INVALID_SIGNATURE') {
      logger.warn('stripe_webhook_invalid_signature', { error: err.message });
      return new Response('Invalid signature', { status: 400 });
    }
    logger.error('stripe_webhook_verify_failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return new Response('Verification failed', { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('stripe_webhook_unhandled', { type: event.eventType });
    return new Response('OK', { status: 200 });
  }

  try {
    const bookingResult = await applyPaymentWebhook({
      provider: 'stripe',
      event,
      isRefundEvent: REFUND_EVENTS.has(event.eventType),
    });
    if (!bookingResult) {
      await applyLiveryInvoiceWebhook({ provider: 'stripe', event });
    }
  } catch (err) {
    // Log but still return 200 — Stripe retries on non-2xx, and a DB blip
    // shouldn't cause duplicate processing storms. The next event will
    // re-converge since our status transitions are idempotent.
    logger.error('stripe_webhook_processing_failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  return new Response('OK', { status: 200 });
}
