import { type NextRequest } from 'next/server';
import {
  findPaymentAccountByExternalId,
  recordWebhookEventOrSkip,
} from '@equestrian/db/queries';
import { nGeniusAdapter } from '@/lib/payments/n-genius';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * N-Genius webhook endpoint. Single URL services every connected outlet;
 * `payload.outletId` identifies the merchant. N-Genius doesn't sign
 * payloads — instead, the merchant configures a custom header + value in
 * the portal which N-Genius echoes on every delivery. We compare that
 * header to the secret we stored at connect time.
 */

const PAID_EVENTS = new Set([
  'CAPTURED',
  'PURCHASED',
  'PURCHASE',
  'AUTHORISED',
  'PARTIALLY_CAPTURED',
]);
const FAILED_EVENTS = new Set(['DECLINED', 'FAILED', 'REVERSED', 'CANCELLED']);
const REFUND_EVENTS = new Set(['REFUNDED', 'PARTIALLY_REFUNDED']);

const HANDLED_EVENTS = new Set<string>([
  ...PAID_EVENTS,
  ...FAILED_EVENTS,
  ...REFUND_EVENTS,
]);

interface NGeniusPayload {
  outletId?: string;
  eventName?: string;
}

export async function POST(request: NextRequest) {
  const body = await request.text();

  let parsed: NGeniusPayload;
  try {
    parsed = JSON.parse(body) as NGeniusPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const outletId = parsed.outletId;
  if (!outletId) {
    logger.warn('n_genius_webhook_missing_outlet_id');
    return new Response('Missing outletId', { status: 400 });
  }

  // Look up the club + its stored webhook header config.
  const account = await findPaymentAccountByExternalId(outletId, 'n_genius');
  if (!account) {
    logger.warn('n_genius_webhook_outlet_not_recognized', { outletId });
    // Return 200 so N-Genius stops retrying for an outlet we don't know.
    return new Response('OK', { status: 200 });
  }

  const creds = account.credentials as
    | { webhookHeaderName?: string; webhookHeaderValue?: string }
    | null;
  const headerName = creds?.webhookHeaderName;
  const headerValue = creds?.webhookHeaderValue;

  if (!headerName || !headerValue) {
    logger.error('n_genius_webhook_header_not_configured', {
      clubId: account.clubId,
      outletId,
    });
    // Fail loud so the merchant sees it in logs and configures the header.
    return new Response('Webhook header not configured', { status: 503 });
  }

  const provided = request.headers.get(headerName) ?? '';

  let event;
  try {
    event = await nGeniusAdapter.verifyWebhook({
      body,
      signatureHeader: provided,
      webhookSecret: headerValue,
    });
  } catch (err) {
    if (err instanceof PaymentProviderError && err.code === 'INVALID_SIGNATURE') {
      logger.warn('n_genius_webhook_invalid_header', {
        clubId: account.clubId,
        outletId,
      });
      return new Response('Invalid webhook header', { status: 401 });
    }
    logger.error('n_genius_webhook_verify_failed', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return new Response('Verification failed', { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('n_genius_webhook_unhandled', { event: event.eventType });
    return new Response('OK', { status: 200 });
  }

  const fresh = await recordWebhookEventOrSkip('n_genius', event.eventId);
  if (!fresh) {
    logger.info('n_genius_webhook_duplicate', {
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    const bookingResult = await applyPaymentWebhook({
      provider: 'n_genius',
      event,
      overrideClubId: account.clubId,
      isRefundEvent: REFUND_EVENTS.has(event.eventType),
    });
    if (!bookingResult) {
      await applyLiveryInvoiceWebhook({ provider: 'n_genius', event });
    }
  } catch (err) {
    logger.error('n_genius_webhook_processing_failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      clubId: account.clubId,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  return new Response('OK', { status: 200 });
}
