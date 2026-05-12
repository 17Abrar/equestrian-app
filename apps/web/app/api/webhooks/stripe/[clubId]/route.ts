import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  claimWebhookEvent,
  getWebhookConfigByClubProvider,
  markWebhookEventFailed,
  markWebhookEventPermanentlyFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import { stripeAdapter } from '@/lib/payments/stripe';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { logger } from '@/lib/logger';

/**
 * Per-club Stripe webhook receiver. The URL embeds the club id because
 * each merchant configures their webhook endpoint in their OWN Stripe
 * dashboard pointing at `/api/webhooks/stripe/<clubId>` — we are not a
 * Connect platform and don't have a single platform-level webhook
 * endpoint. Mirrors the Ziina per-club URL pattern.
 *
 * Each club's webhook signing secret lives in their
 * `club_payment_accounts.encrypted_credentials` blob; we look it up by
 * the URL's clubId, decrypt, and verify the `Stripe-Signature` header
 * against it.
 *
 * Audit QA-15 — response shape is uniform across the rejection paths
 * (no account / no secret / invalid signature) so an attacker who has a
 * clubId UUID can't probe whether Stripe is connected for that club.
 */

const PAID_EVENTS = new Set(['payment_intent.succeeded']);
const FAILED_EVENTS = new Set(['payment_intent.payment_failed', 'payment_intent.canceled']);
const REFUND_EVENTS = new Set(['charge.refunded', 'charge.refund.updated']);

const HANDLED_EVENTS = new Set<string>([...PAID_EVENTS, ...FAILED_EVENTS, ...REFUND_EVENTS]);

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
    logger.error('stripe_webhook_unhandled_error', {
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response('Internal error', { status: 500 });
  }
}

async function handlePost(request: NextRequest, { params }: RouteParams) {
  // Audit F-12 (2026-05-08 r6): IP-keyed `failClosed` rate limit on
  // the per-club Stripe webhook. Mirrors the n-genius / platform-Ziina
  // pattern. Stripe's documented retry cadence (5 attempts over ~3
  // days) sits comfortably under 60/min. Without this, anyone with a
  // leaked clubId UUID can drive arbitrary load through the body-cap
  // → DB-lookup → AES-GCM-decrypt → HMAC-compute pipeline (~100µs
  // HMAC + a credential decrypt per request, with nothing capping it).
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`webhook:stripe:${ip}`, {
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

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.stripe, 'stripe');
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    logger.warn('stripe_webhook_missing_signature', { clubId });
    return new Response('Invalid signature', { status: 401 });
  }

  // Audit B-9 + QA-15: getWebhookConfigByClubProvider returns ONLY the
  // webhook fields, never the Stripe secret key. Identical 401 for every
  // rejection path so connect-state isn't leaked via response shape.
  const account = await getWebhookConfigByClubProvider(clubId, 'stripe');
  if (!account) {
    logger.warn('stripe_webhook_club_not_connected', { clubId });
    return new Response('Invalid signature', { status: 401 });
  }

  const webhookSecret = account.webhookSigningSecret;
  if (!webhookSecret) {
    // Operator-actionable: the club connected Stripe but didn't paste the
    // webhook signing secret. Log loud, return identical shape.
    logger.error('stripe_webhook_secret_not_configured', { clubId });
    return new Response('Invalid signature', { status: 401 });
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
      logger.warn('stripe_webhook_invalid_signature', { clubId });
      return new Response('Invalid signature', { status: 401 });
    }
    logger.error('stripe_webhook_verify_failed', {
      clubId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return new Response('Invalid signature', { status: 401 });
  }

  // Audit F-38 (2026-05-07 r4) updated: Cavaliq's direct-keys Stripe flow
  // never populates `event.account` (that field is Connect-platform only).
  // The check below therefore short-circuits in the direct-keys path and
  // the URL-bound clubId is the ONLY binding signal in production today.
  // The check is kept as a defense-in-depth guard for any future Connect
  // path: if both `event.account` and `account.externalAccountId` are
  // populated AND they disagree, reject. Operators MUST use distinct
  // `whsec_…` per club (each Stripe webhook endpoint has its own secret);
  // copy-pasting one secret across two clubs would defeat both the URL
  // binding and Stripe's signature scope.
  if (
    event.providerAccountId &&
    account.externalAccountId &&
    event.providerAccountId !== account.externalAccountId
  ) {
    logger.warn('stripe_webhook_account_mismatch', {
      clubId,
      expected: account.externalAccountId,
      got: event.providerAccountId,
    });
    return new Response('Invalid signature', { status: 401 });
  }

  if (!HANDLED_EVENTS.has(event.eventType)) {
    logger.info('stripe_webhook_unhandled', { clubId, type: event.eventType });
    return new Response('OK', { status: 200 });
  }

  // Two-phase claim — `claimWebhookEvent` keys on (provider, eventId)
  // which is unique across all clubs (Stripe event ids are globally
  // unique strings like `evt_…`).
  const claim = await claimWebhookEvent('stripe', event.eventId);

  if (claim.status === 'already_processed') {
    logger.info('stripe_webhook_duplicate', {
      clubId,
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    logger.info('stripe_webhook_in_flight', {
      clubId,
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('Processing in progress', { status: 503 });
  }

  if (claim.status === 'permanently_failed') {
    logger.error('webhook_permanently_failed', {
      provider: 'stripe',
      clubId,
      eventId: event.eventId,
      eventType: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    const bookingResult = await applyPaymentWebhook({
      provider: 'stripe',
      event,
      // URL-bound clubId is authoritative — the signature check above
      // proved the body was signed with this club's secret. Skip the
      // external-id lookup that the platform Connect path used.
      overrideClubId: clubId,
      isRefundEvent: REFUND_EVENTS.has(event.eventType),
    });

    // Audit F-19 (2026-05-07 r5): when the booking helper resolved
    // a club but found no booking (`kind: 'no_target'`), fall through
    // to the livery invoice helper. If THAT also returns `no_target`,
    // mark the dedup row permanently_failed so the alert fires for
    // operators. Pre-fix the route silently flipped dedup to
    // `processed` and we'd lose every misrouted webhook with no
    // signal.
    let invoiceResult: Awaited<ReturnType<typeof applyLiveryInvoiceWebhook>> = null;
    const bookingMissed = !bookingResult || bookingResult.kind === 'no_target';
    if (bookingMissed) {
      invoiceResult = await applyLiveryInvoiceWebhook({
        provider: 'stripe',
        event,
        clubId,
      });
    }

    // Audit MED (2026-05-05 pass 2): if applyPaymentWebhook signalled
    // a permanent failure (e.g. paid event for a cancelled booking),
    // record it as such so the `webhook_permanently_failed` alert
    // fires for an operator.
    if (bookingResult?.kind === 'matched' && bookingResult.permanentFailureReason) {
      await markWebhookEventPermanentlyFailed(
        'stripe',
        event.eventId,
        bookingResult.permanentFailureReason,
      );
    } else if (
      // Audit F-13 (2026-05-08 r6): livery flow now signals
      // permanentFailureReason (e.g. paid for a cancelled invoice).
      // Same handling as the booking branch.
      invoiceResult?.kind === 'matched' &&
      invoiceResult.permanentFailureReason
    ) {
      await markWebhookEventPermanentlyFailed(
        'stripe',
        event.eventId,
        invoiceResult.permanentFailureReason,
      );
    } else if (bookingMissed && (!invoiceResult || invoiceResult.kind === 'no_target')) {
      // Both the booking AND the livery invoice helpers came up empty
      // — neither side can ever resolve this event. F-19 escalation.
      await markWebhookEventPermanentlyFailed(
        'stripe',
        event.eventId,
        `No booking or livery invoice matched providerPaymentId=${event.providerPaymentId ?? 'unknown'}`,
      );
    } else {
      await markWebhookEventProcessed('stripe', event.eventId);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await markWebhookEventFailed('stripe', event.eventId, message);
    logger.error('stripe_webhook_processing_failed', {
      clubId,
      eventType: event.eventType,
      eventId: event.eventId,
      attempt: claim.attempt,
      error: message,
    });
    return new Response('Processing failed', { status: 500 });
  }
}
