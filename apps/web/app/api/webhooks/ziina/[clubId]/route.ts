import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  claimWebhookEvent,
  getWebhookConfigByClubProvider,
  markWebhookEventFailed,
  markWebhookEventPermanentlyFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import { ziinaAdapter } from '@/lib/payments/ziina';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
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
const HANDLED_EVENTS = new Set<string>(['payment_intent.status.updated', 'refund.status.updated']);

const clubIdSchema = z.string().uuid();

interface RouteParams {
  params: Promise<{ clubId: string }>;
}

/**
 * Audit F-15 (2026-05-07 r4): top-level try/catch wrapper. Inner
 * branches already catch the documented failure modes (signature
 * verification / DB apply / mark helpers), but an unhandled throw
 * from `await params`, `readWebhookBody`, `getWebhookConfigByClubProvider`,
 * or `claimWebhookEvent` would otherwise propagate to the runtime and
 * surface as an opaque 500 with whatever stack trace OpenNext serializes
 * into the response. The wrapper sanitizes that to a static
 * `Internal error` 500.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    return await handlePost(request, { params });
  } catch (err) {
    logger.error('ziina_webhook_unhandled_error', {
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response('Internal error', { status: 500 });
  }
}

async function handlePost(request: NextRequest, { params }: RouteParams) {
  // Audit F-12 (2026-05-08 r6): IP-keyed `failClosed` rate limit on
  // the per-club Ziina webhook. Mirrors the n-genius / platform-Ziina
  // pattern. A leaked clubId UUID + missing rate limit lets an
  // attacker drive arbitrary load through the body-cap → DB-lookup
  // → AES-GCM-decrypt → HMAC-compute pipeline.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`webhook:ziina:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
    failClosed: true,
  });
  if (!rl.allowed) {
    return new Response('Too many requests', { status: 429 });
  }

  const { clubId: rawClubId } = await params;

  const parsedClubId = clubIdSchema.safeParse(rawClubId);
  if (!parsedClubId.success) {
    return new Response('Invalid club id', { status: 400 });
  }
  const clubId = parsedClubId.data;

  // Audit F-12 (2026-05-06 r2): hoist the signature-header check
  // BEFORE the body read so a forgery without the header pays
  // constant cost — no JSON parse, no HMAC compute. The size cap
  // already gates pathological inputs; this just makes the unsigned-
  // forgery path even cheaper.
  const signature = request.headers.get('x-hmac-signature');
  if (!signature) {
    logger.warn('ziina_webhook_missing_signature', { clubId });
    return new Response('Missing signature', { status: 400 });
  }

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.ziina, 'ziina');
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }

  // Audit B-9: getWebhookConfigByClubProvider returns ONLY the webhook
  // fields, never the Ziina API key. A future logger.error here can't
  // accidentally surface the API key into observability.
  //
  // Audit AI-15: a webhook URL that returns 200 when no account is
  // connected and 401 when an invalid signature is presented lets an
  // attacker probe whether a clubId has Ziina connected. clubIds are
  // UUIDs (not enumerable) but the asymmetry was unintentional. Unify
  // the responses to 401 with an identical body so the connect state
  // isn't observable via response shape. Operator-distinguishing
  // context lives in the log, not the response.
  const account = await getWebhookConfigByClubProvider(clubId, 'ziina');
  if (!account) {
    logger.warn('ziina_webhook_club_not_connected', { clubId });
    return new Response('Invalid signature', { status: 401 });
  }

  const webhookSecret = account.webhookSigningSecret;
  if (!webhookSecret) {
    // Operator misconfiguration: the merchant connected Ziina but never
    // saved the webhook signing secret. Surface the alert via log rather
    // than via a distinct response code so attackers and Ziina see the
    // same shape as every other rejection path.
    logger.error('ziina_webhook_secret_not_configured', { clubId });
    return new Response('Invalid signature', { status: 401 });
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
    return new Response('Invalid signature', { status: 401 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('ziina_webhook_unhandled', { event: event.eventType, clubId });
    return new Response('OK', { status: 200 });
  }

  // Audit HIGH-1 (2026-05-05 pass 2): the previous defense-in-depth
  // comparison block here checked `event.providerAccountId` (a real
  // Ziina merchant id read from `payload.data.account_id`) against
  // `account.externalAccountId` (a synthesized `ziina_<clubId>` stored
  // at connect time because Ziina doesn't expose a stable merchant id
  // we can read without extra scopes — see ziina.ts:110-115). Those
  // two values can NEVER match. The check was a silent ticking bomb:
  // the moment Ziina ever populates `data.account_id` on a payload
  // (the adapter reads it defensively, suggesting it sometimes does),
  // every Ziina webhook for the club returns 401 and bookings stay
  // forever-pending. Removed entirely. The URL's clubId + per-club
  // `webhook_signing_secret` (verified above) already prove tenancy
  // — a misconfigured-shared-secret scenario is the only residual,
  // and operators can detect it by comparing clubId-vs-payload-merchant
  // in the dashboard if they need to.

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

  if (claim.status === 'permanently_failed') {
    logger.error('webhook_permanently_failed', {
      provider: 'ziina',
      eventId: event.eventId,
      eventType: event.eventType,
      clubId,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    // Treat every `refund.status.updated` as a refund event so the webhook
    // helper can apply the lifecycle (pending → succeeded → recordRefund;
    // pending → failed → reverseRefund). The previous `&& succeeded` gate
    // dropped the failed-refund path silently — audit C-1.
    const bookingResult = await applyPaymentWebhook({
      provider: 'ziina',
      event,
      overrideClubId: clubId,
      isRefundEvent: REFUND_EVENTS.has(event.eventType),
    });

    // Audit F-19 (2026-05-07 r5): a payment intent is for a booking OR
    // a livery invoice, never both. When the booking helper missed
    // (`null` = couldn't even resolve the club, `no_target` = club
    // resolved but no booking), fall through to the invoice helper.
    // If THAT also misses, mark dedup permanently_failed so the alert
    // fires.
    let invoiceResult: Awaited<ReturnType<typeof applyLiveryInvoiceWebhook>> = null;
    const bookingMissed = !bookingResult || bookingResult.kind === 'no_target';
    if (bookingMissed) {
      invoiceResult = await applyLiveryInvoiceWebhook({
        provider: 'ziina',
        event,
        clubId,
      });
    }

    if (bookingResult?.kind === 'matched' && bookingResult.permanentFailureReason) {
      await markWebhookEventPermanentlyFailed(
        'ziina',
        event.eventId,
        bookingResult.permanentFailureReason,
      );
    } else if (
      // Audit F-13 (2026-05-08 r6): livery flow now signals
      // permanentFailureReason (e.g. paid for a cancelled invoice).
      invoiceResult?.kind === 'matched' &&
      invoiceResult.permanentFailureReason
    ) {
      await markWebhookEventPermanentlyFailed(
        'ziina',
        event.eventId,
        invoiceResult.permanentFailureReason,
      );
    } else if (bookingMissed && (!invoiceResult || invoiceResult.kind === 'no_target')) {
      await markWebhookEventPermanentlyFailed(
        'ziina',
        event.eventId,
        `No booking or livery invoice matched providerPaymentId=${event.providerPaymentId ?? 'unknown'}`,
      );
    } else {
      await markWebhookEventProcessed('ziina', event.eventId);
    }
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
