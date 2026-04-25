import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  adminGetPaymentAccountByProvider,
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import { ziinaAdapter } from '@/lib/payments/ziina';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * Ziina webhook endpoint. The URL embeds the club id because Ziina webhooks
 * don't carry a stable merchant identifier in the body — each club should
 * register a URL like `/api/webhooks/ziina/<clubId>` when they configure
 * their webhook endpoint via Ziina's `/webhook` API.
 *
 * The `X-Hmac-Signature` header contains the hex-encoded SHA-256 HMAC of
 * the raw request body, signed with the webhook secret the merchant set
 * when registering the endpoint.
 */

const REFUND_EVENTS = new Set(['refund.status.updated']);
const HANDLED_EVENTS = new Set<string>([
  'payment_intent.status.updated',
  'refund.status.updated',
]);

const clubIdSchema = z.string().uuid();

interface RouteParams {
  params: Promise<{ clubId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { clubId: rawClubId } = await params;

  const parsedClubId = clubIdSchema.safeParse(rawClubId);
  if (!parsedClubId.success) {
    return new Response('Invalid club id', { status: 400 });
  }
  const clubId = parsedClubId.data;

  const body = await request.text();
  const signature = request.headers.get('x-hmac-signature');

  if (!signature) {
    logger.warn('ziina_webhook_missing_signature', { clubId });
    return new Response('Missing signature', { status: 400 });
  }

  const account = await adminGetPaymentAccountByProvider(clubId, 'ziina');
  if (!account) {
    logger.warn('ziina_webhook_club_not_connected', { clubId });
    return new Response('OK', { status: 200 });
  }

  const creds = account.credentials as { webhookSigningSecret?: string } | null;
  const webhookSecret = creds?.webhookSigningSecret;

  if (!webhookSecret) {
    logger.error('ziina_webhook_secret_not_configured', { clubId });
    return new Response('Webhook secret not configured', { status: 503 });
  }

  let event;
  try {
    event = await ziinaAdapter.verifyWebhook({
      body,
      signatureHeader: signature,
      webhookSecret,
    });
  } catch (err) {
    if (err instanceof PaymentProviderError && err.code === 'INVALID_SIGNATURE') {
      logger.warn('ziina_webhook_invalid_signature', { clubId });
      return new Response('Invalid signature', { status: 401 });
    }
    logger.error('ziina_webhook_verify_failed', {
      clubId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return new Response('Verification failed', { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('ziina_webhook_unhandled', { event: event.eventType, clubId });
    return new Response('OK', { status: 200 });
  }

  const claim = await claimWebhookEvent('ziina', event.eventId);

  if (claim.status === 'already_processed') {
    logger.info('ziina_webhook_duplicate', {
      eventId: event.eventId,
      type: event.eventType,
      clubId,
    });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    logger.info('ziina_webhook_in_flight', {
      eventId: event.eventId,
      type: event.eventType,
      clubId,
    });
    return new Response('Processing in progress', { status: 503 });
  }

  try {
    const bookingResult = await applyPaymentWebhook({
      provider: 'ziina',
      event,
      overrideClubId: clubId,
      isRefundEvent: REFUND_EVENTS.has(event.eventType) && event.status === 'succeeded',
    });

    // Didn't match a booking? Try a livery invoice. A payment intent is for
    // one OR the other, never both, so we only run the second lookup when
    // the first comes up empty.
    if (!bookingResult) {
      await applyLiveryInvoiceWebhook({ provider: 'ziina', event });
    }
    await markWebhookEventProcessed('ziina', event.eventId);
    return new Response('OK', { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await markWebhookEventFailed('ziina', event.eventId, message);
    logger.error('ziina_webhook_processing_failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      clubId,
      attempt: claim.attempt,
      error: message,
    });
    return new Response('Processing failed', { status: 500 });
  }
}
