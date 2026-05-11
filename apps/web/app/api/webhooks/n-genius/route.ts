import { type NextRequest } from 'next/server';
import {
  claimWebhookEvent,
  findWebhookConfigByExternalId,
  markWebhookEventFailed,
  markWebhookEventPermanentlyFailed,
  markWebhookEventProcessed,
  wasProviderPaymentIssuedRecently,
} from '@equestrian/db/queries';
import { nGeniusAdapter } from '@/lib/payments/n-genius';
import { applyPaymentWebhook, applyLiveryInvoiceWebhook } from '@/lib/payments/webhook-helpers';
import { PaymentProviderError } from '@/lib/payments/types';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
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

const HANDLED_EVENTS = new Set<string>([...PAID_EVENTS, ...FAILED_EVENTS, ...REFUND_EVENTS]);

interface NGeniusPayload {
  outletId?: string;
  eventName?: string;
}

/**
 * Audit F-15 (2026-05-07 r4): top-level try/catch wrapper. The inner
 * handler already catches the documented failure modes (rate-limit /
 * signature mismatch / claim contention / apply-helper throw), but a
 * synchronous exception from an unwrapped path — `JSON.parse` failing
 * because the body wasn't consumable as text, an uncaught `await`
 * rejection from a Cloudflare KV outage, a Drizzle driver crash —
 * would otherwise propagate to the runtime and surface as an opaque
 * 500 carrying whatever stack trace OpenNext serializes into the
 * response body. The wrapper swallows that and emits a sanitized
 * `Internal error` 500 so no exception detail leaks. Mirrors the
 * pattern in the per-club Stripe + Ziina receivers.
 */
export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (err) {
    logger.error('n_genius_webhook_unhandled_error', {
      error: err instanceof Error ? err.message : 'unknown',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return new Response('Internal error', { status: 500 });
  }
}

async function handlePost(request: NextRequest) {
  // IP-keyed rate limit before any DB work — N-Genius's single endpoint
  // accepts arbitrary outletIds, so a fuzzer could otherwise force the
  // route to JSON.parse + DB-lookup + AES-GCM-decrypt on every request
  // (audit B-7). Generous cap because legitimate retries on transient
  // failures should not lock out the merchant.
  //
  // Audit F-4 (2026-05-07 r4): `failClosed: true`. Pre-fix, a KV outage
  // would degrade the limiter to "allow everything" — exactly when an
  // attacker bursting against the webhook would be most effective. The
  // platform-Ziina + per-club Ziina routes already fail closed; align
  // n-genius with them. Mirrors the F-17 fix in `ziina-platform/route.ts`.
  // Audit r5 F-46 (2026-05-07): IP resolver moved to `lib/request-ip.ts`.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`webhook:n_genius:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
    failClosed: true,
  });
  if (!rl.allowed) {
    logger.warn('n_genius_webhook_rate_limited', { ip });
    return new Response('Too many requests', { status: 429 });
  }

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.n_genius, 'n_genius');
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }

  let parsed: NGeniusPayload;
  try {
    parsed = JSON.parse(body) as NGeniusPayload;
  } catch (err) {
    // Audit AI-32g — only log the length, not the body. N-Genius
    // payloads include cardholderName / last4 and a 200-char preview
    // could leak partial PII to log aggregators.
    logger.warn('n_genius_webhook_invalid_json', {
      error: err instanceof Error ? err.message : 'unknown',
      bodyLength: body.length,
    });
    return new Response('Invalid JSON', { status: 400 });
  }

  const outletId = parsed.outletId;
  if (!outletId) {
    logger.warn('n_genius_webhook_missing_outlet_id');
    return new Response('Missing outletId', { status: 400 });
  }

  // Look up the club + its stored webhook header config. Audit B-9: the
  // narrowed `findWebhookConfigByExternalId` returns ONLY the webhook
  // fields, never the full credentials blob — a future
  // `logger.error(..., { account })` here can't accidentally leak the
  // N-Genius API key.
  const account = await findWebhookConfigByExternalId(outletId, 'n_genius');
  if (!account) {
    // `error` (not `warn`) so the alert rule fires — an unknown outlet is
    // almost always a misconfiguration (the merchant connected with one
    // outlet and N-Genius is delivering for another, OR the payment_account
    // row was deleted while N-Genius retains the URL). Without this signal,
    // payments would silently fail post-checkout because no booking gets
    // updated.
    logger.error('n_genius_webhook_outlet_not_recognized', {
      outletId,
      eventName: parsed.eventName,
    });
    // 401 (not 200) so a third party fuzzing outletIds can't distinguish
    // "unknown outlet" from "known outlet, wrong header" — see audit B-6.
    // N-Genius does retry on 4xx but bounded (their max-retries policy
    // covers the legit misconfig case after a small bounded window).
    return new Response('Unknown outlet', { status: 401 });
  }

  const headerName = account.webhookHeaderName;
  const headerValue = account.webhookHeaderValue;

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

  // Audit F-20 (2026-05-07 r5): defense-in-depth — N-Genius webhook
  // auth is a shared-secret echo (no body-binding), so a leaked
  // (header, body) pair lets an attacker craft fresh REFUNDED /
  // PURCHASED events for arbitrary references. The 90 s freshness
  // window in the adapter is the primary fix; this gate adds a
  // "reference must correspond to a payment we issued in the last
  // 24 h" check so an attacker needs both the secret AND a recently-
  // issued reference to forge a useful event. NOT load-bearing —
  // legitimate events for old references (a 25h-old PURCHASED that
  // gets retried) would now be rejected, so we log loudly and accept
  // the trade-off (operator can manually mark paid; the inbound
  // reference is a finite alphanumeric space that's
  // already-collision-resistant). Guarded by a try/catch so a DB
  // hiccup doesn't sink the webhook flow.
  if (event.providerPaymentId) {
    try {
      const recentlyIssued = await wasProviderPaymentIssuedRecently(
        event.providerPaymentId,
        'n_genius',
        account.clubId,
      );
      if (!recentlyIssued) {
        logger.warn('n_genius_webhook_reference_not_recently_issued', {
          clubId: account.clubId,
          eventType: event.eventType,
          eventId: event.eventId,
          providerPaymentId: event.providerPaymentId,
        });
        // 401 to align with the rest of the rejection paths in this
        // route — the attacker shouldn't learn whether the reference
        // is unknown vs. known-but-stale.
        return new Response('Invalid webhook reference', { status: 401 });
      }
    } catch (err) {
      logger.warn('n_genius_webhook_reference_freshness_check_failed', {
        clubId: account.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      // Fail closed: a transient DB error during the defense-in-depth
      // freshness check leaves the route relying solely on signature
      // verification. The freshness gate's job is to refuse a replayed
      // (signed) payload whose providerPaymentId we no longer recognise
      // — losing that gate quietly under a transient outage is the
      // wrong direction. 503 lets N-Genius retry once Upstash / Drizzle
      // recovers; the dedup row hasn't been written yet so the retry
      // is safe.
      return new Response('Freshness check temporarily unavailable', {
        status: 503,
      });
    }
  }

  const claim = await claimWebhookEvent('n_genius', event.eventId);

  if (claim.status === 'already_processed') {
    logger.info('n_genius_webhook_duplicate', {
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('OK', { status: 200 });
  }

  if (claim.status === 'in_flight') {
    logger.info('n_genius_webhook_in_flight', {
      eventId: event.eventId,
      type: event.eventType,
    });
    return new Response('Processing in progress', { status: 503 });
  }

  if (claim.status === 'permanently_failed') {
    logger.error('webhook_permanently_failed', {
      provider: 'n_genius',
      eventId: event.eventId,
      eventType: event.eventType,
      clubId: account.clubId,
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

    // Audit F-19 (2026-05-07 r5): fall through to the invoice helper
    // when the booking side missed (null OR no_target); escalate to
    // permanently_failed when both miss so the alert fires.
    let invoiceResult: Awaited<ReturnType<typeof applyLiveryInvoiceWebhook>> = null;
    const bookingMissed = !bookingResult || bookingResult.kind === 'no_target';
    if (bookingMissed) {
      invoiceResult = await applyLiveryInvoiceWebhook({
        provider: 'n_genius',
        event,
        clubId: account.clubId,
      });
    }

    if (bookingResult?.kind === 'matched' && bookingResult.permanentFailureReason) {
      await markWebhookEventPermanentlyFailed(
        'n_genius',
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
        'n_genius',
        event.eventId,
        invoiceResult.permanentFailureReason,
      );
    } else if (bookingMissed && (!invoiceResult || invoiceResult.kind === 'no_target')) {
      await markWebhookEventPermanentlyFailed(
        'n_genius',
        event.eventId,
        `No booking or livery invoice matched providerPaymentId=${event.providerPaymentId ?? 'unknown'}`,
      );
    } else {
      await markWebhookEventProcessed('n_genius', event.eventId);
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await markWebhookEventFailed('n_genius', event.eventId, message);
    logger.error('n_genius_webhook_processing_failed', {
      eventType: event.eventType,
      eventId: event.eventId,
      clubId: account.clubId,
      attempt: claim.attempt,
      error: message,
    });
    return new Response('Processing failed', { status: 500 });
  }
}
