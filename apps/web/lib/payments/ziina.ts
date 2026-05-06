import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type DirectConnectInput,
  type DirectConnectResult,
  type PaymentProviderAdapter,
  type PaymentStatusInput,
  type PaymentStatusResult,
  type RefundInput,
  type RefundResult,
  type VerifyWebhookInput,
  type WebhookEvent,
  type PaymentIntentStatus,
  PaymentProviderError,
} from './types';

/**
 * Ziina adapter — UAE fintech with a PaymentIntent-style API.
 *
 * Source of truth: https://docs.ziina.com/api-reference/payment-intent
 *
 * ─ Auth: Bearer JWT (the "API key" the merchant copies from the dashboard
 *   is an OAuth token scoped to `write_payment_intents` / `write_refunds`).
 * ─ Base URL: https://api-v2.ziina.com/api (note the `/api` suffix).
 * ─ Amount is in minor units (fils). Minimum 2 AED = 200 fils.
 * ─ Idempotency is carried on the request body as `operation_id` on payment
 *   intents and `id` on refunds — Ziina has no `Idempotency-Key` header.
 * ─ Webhooks: Ziina posts `{ event, data }` with an `X-Hmac-Signature` header
 *   holding the hex-encoded SHA-256 HMAC of the raw request body.
 */

const API_BASE_URL = process.env.ZIINA_API_BASE_URL ?? 'https://api-v2.ziina.com/api';

const ziinaCredentialsSchema = z.object({
  apiKey: z.string().min(1),
  webhookSigningSecret: z.string().min(1).optional(),
});

type ZiinaCredentials = z.infer<typeof ziinaCredentialsSchema>;

function parseCredentials(raw: unknown): ZiinaCredentials {
  const result = ziinaCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      `Ziina credentials are invalid: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

function authHeaders(apiKey: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

// Ziina PaymentIntent status values per docs:
//   requires_payment_instrument, requires_user_action, pending, completed, failed, canceled
function mapIntentStatus(status: string | undefined): PaymentIntentStatus {
  switch (status) {
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'cancelled';
    case 'requires_payment_instrument':
    case 'requires_user_action':
      return 'requires_action';
    case 'pending':
    default:
      return 'pending';
  }
}

export const ziinaAdapter: PaymentProviderAdapter = {
  name: 'ziina',
  displayName: 'Ziina',

  async connectWithCredentials(input: DirectConnectInput): Promise<DirectConnectResult> {
    const creds = parseCredentials({
      apiKey: input.credentials.apiKey,
      webhookSigningSecret: input.credentials.webhookSigningSecret,
    });

    // Ziina doesn't publish a lightweight "validate this token" endpoint.
    // Probe `GET /payment_intent/<bogus>`: a valid token → 404, an invalid
    // token → 401/403. We accept 404 as proof the credential is usable.
    const probe = await fetch(`${API_BASE_URL}/payment_intent/ping_00000000`, {
      method: 'GET',
      headers: authHeaders(creds.apiKey),
    });

    if (probe.status === 401 || probe.status === 403) {
      throw new PaymentProviderError(
        'AUTH_FAILED',
        'Ziina rejected the API key — copy it from the Ziina business dashboard and try again.',
      );
    }

    return {
      // Ziina doesn't expose a stable "merchant id" we can read without extra
      // scopes; key the account on the clubId so a disconnect/reconnect after
      // an API-key rotation produces the same external id and the
      // findPaymentAccountByExternalId fallback continues to resolve.
      externalAccountId: `ziina_${input.clubId}`,
      metadata: {
        apiBaseUrl: API_BASE_URL,
        hasWebhookSecret: !!creds.webhookSigningSecret,
        // Audit MED (2026-05-05 pass 2): Ziina is a UAE-only fintech
        // and settles exclusively in AED. Stamping the metadata lets
        // the booking-payment route's currency-parity check refuse a
        // booking in any other currency before hitting the provider.
        defaultCurrency: 'AED',
      },
      credentials: { ...creds },
    };
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const creds = parseCredentials(input.account.credentials);

    const res = await fetch(`${API_BASE_URL}/payment_intent`, {
      method: 'POST',
      headers: authHeaders(creds.apiKey),
      body: JSON.stringify({
        // `operation_id` is Ziina's idempotency mechanism — resubmitting with
        // the same value returns the original intent instead of creating a dup.
        operation_id: input.idempotencyKey,
        amount: input.amountMinorUnits,
        currency_code: input.currency.toUpperCase(),
        message: input.description ?? `Booking ${input.bookingId}`,
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        failure_url: input.returnUrl,
        test: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaymentProviderError(
        'CREATE_PAYMENT_FAILED',
        `Ziina payment-intent creation failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500 || res.status === 429 },
      );
    }

    const json = (await res.json()) as {
      id?: string;
      redirect_url?: string;
      status?: string;
    };

    if (!json.id || !json.redirect_url) {
      throw new PaymentProviderError(
        'MALFORMED_RESPONSE',
        'Ziina did not return `id` and `redirect_url`',
      );
    }

    return {
      flow: 'redirect',
      providerPaymentId: json.id,
      paymentUrl: json.redirect_url,
      status: mapIntentStatus(json.status),
    };
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const creds = parseCredentials(input.account.credentials);

    const res = await fetch(`${API_BASE_URL}/refund`, {
      method: 'POST',
      headers: authHeaders(creds.apiKey),
      body: JSON.stringify({
        // Refunds are idempotent on the `id` field — same id = same refund.
        id: input.idempotencyKey,
        payment_intent_id: input.providerPaymentId,
        amount: input.amountMinorUnits,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaymentProviderError(
        'REFUND_FAILED',
        `Ziina refund failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as { id?: string; status?: string };

    const mappedStatus: 'pending' | 'succeeded' | 'failed' =
      json.status === 'completed'
        ? 'succeeded'
        : json.status === 'failed'
          ? 'failed'
          : 'pending';

    return {
      providerRefundId: json.id ?? input.idempotencyKey,
      status: mappedStatus,
    };
  },

  async getPaymentStatus(input: PaymentStatusInput): Promise<PaymentStatusResult> {
    const creds = parseCredentials(input.account.credentials);

    const res = await fetch(
      `${API_BASE_URL}/payment_intent/${encodeURIComponent(input.providerPaymentId)}`,
      {
        method: 'GET',
        headers: authHeaders(creds.apiKey),
      },
    );

    if (!res.ok) {
      throw new PaymentProviderError(
        'STATUS_LOOKUP_FAILED',
        `Ziina status lookup failed (${res.status})`,
      );
    }

    const json = (await res.json()) as {
      status?: string;
      amount?: number;
    };

    const status = mapIntentStatus(json.status);
    // Ziina doesn't expose `amount_received`; treat `amount` as received only
    // once the intent reaches a terminal success state. `undefined` for
    // non-terminal so callers don't conflate it with a 0-amount capture
    // (audit AI-32e).
    const amountReceived = status === 'succeeded' ? (json.amount ?? 0) : undefined;

    return { status, amountReceivedMinorUnits: amountReceived };
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    // Per Ziina docs: `X-Hmac-Signature` header carries the hex-encoded
    // SHA-256 HMAC of the raw request body, using the secret configured when
    // the webhook endpoint was registered.
    const expected = createHmac('sha256', input.webhookSecret)
      .update(input.body)
      .digest('hex');
    // Tolerate a leading `sha256=` prefix that some HMAC pipelines prepend,
    // and normalise case (audit B-8). `expected` is always lowercase per
    // Node's crypto API; `provided` may arrive uppercase from clients that
    // copied the value verbatim.
    const providedRaw = input.signatureHeader.trim();
    const provided = providedRaw
      .replace(/^sha256=/i, '')
      .toLowerCase();

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      // Length info is useful for distinguishing a format mismatch
      // (recoverable by upgrading the adapter) from a real attacker —
      // never log the actual signature value.
      logger.warn('ziina_webhook_signature_mismatch', {
        expectedLength: a.length,
        providedLength: b.length,
        hasSha256Prefix: /^sha256=/i.test(providedRaw),
      });
      throw new PaymentProviderError(
        'INVALID_SIGNATURE',
        'Ziina webhook signature verification failed',
      );
    }

    // Ziina webhook payloads are { event, data }. Known events:
    //   - payment_intent.status.updated
    //   - refund.status.updated  (data carries refund.id, payment_intent_id,
    //     amount, status — see https://docs.ziina.com/api-reference/refund)
    const payload = JSON.parse(input.body) as {
      event?: string;
      data?: {
        id?: string;
        status?: string;
        amount?: number;
        currency_code?: string;
        account_id?: string;
        created_at?: string;
        // Ziina refund events carry the parent payment_intent's id here
        // when the event is `refund.status.updated`. Pull it so the
        // webhook handler can find the booking by its provider id.
        payment_intent_id?: string;
      };
    };

    // Replay defence is provided exclusively by `webhook_events` dedup
    // (PRIMARY KEY on (provider, event_id)) — a captured (body, signature)
    // pair will be rejected as "already processed" the second time it
    // lands. The previous freshness window compared `Date.now()` to
    // `payload.data.created_at`, which is the **PaymentIntent resource's
    // creation time**, not the event's send time. A user who clicks the
    // redirect link, opens their bank app, completes 3-D-Secure, and
    // returns can easily take 6-10 minutes between intent creation and
    // the `completed` event — legitimate webhooks were being rejected
    // (audit C-4). Drop the check entirely; dedup catches replays.

    const isRefundEvent = payload.event?.startsWith('refund.') ?? false;
    const status = mapIntentStatus(payload.data?.status);
    const amountReceived =
      status === 'succeeded' && !isRefundEvent ? (payload.data?.amount ?? 0) : undefined;
    const currency = payload.data?.currency_code?.toUpperCase();
    // For refund events, the `data.amount` is the refund delta and
    // `data.payment_intent_id` carries the parent PI. The webhook handler
    // uses these to call `recordBookingRefund(amount)` so the booking
    // ledger tracks the rider's actual refunded total — see audit C-1.
    const refundAmountMinor =
      isRefundEvent && typeof payload.data?.amount === 'number'
        ? payload.data.amount
        : undefined;
    const refundStatus: WebhookEvent['refundStatus'] | undefined = isRefundEvent
      ? status === 'succeeded'
        ? 'succeeded'
        : status === 'failed'
          ? 'failed'
          : status === 'pending' || status === 'requires_action'
            ? 'pending'
            : undefined
      : undefined;

    // Compose the eventId from `(event, payment_intent_id, status)` so the
    // pending → completed transition stream produces distinct ids. Without
    // `status` in the key, every transition for the same intent collides
    // and `claimWebhookEvent` discards the second event as already-processed
    // — leaving the booking stuck on the first non-terminal status.
    //
    // When `data.id` is absent, fall back to a deterministic SHA-256 of the
    // body (matching the n-genius pattern). `Date.now()` would give every
    // redelivery a unique key, defeating the whole dedup table.
    const intentId = payload.data?.id;
    const statusKey = payload.data?.status ?? 'nostatus';
    const eventName = payload.event ?? 'ziina.event';
    // Audit HIGH-7 (2026-05-05): include the resource's created_at in the
    // dedup composite. Without it, two distinct events that share
    // (event, intent_id, status) — possible on a partial-refund flow,
    // a status oscillation, or a Ziina retry of a stale event — collide
    // and the second is silently `already_processed`. created_at is
    // not the event's send time but the PaymentIntent's creation time;
    // for our dedup purposes that's still distinct per (intent, status,
    // moment-of-state-change). When absent, fall back to body-hash.
    const createdKey =
      typeof payload.data?.created_at === 'string'
        ? payload.data.created_at
        : 'nots';
    // 32 hex chars = 128 bits of entropy on the SHA-256 — collision is
    // astronomically unlikely for any practical webhook volume but cheap
    // to extend from the prior 24 (96 bits).
    //
    // Audit LOW (2026-05-05 pass 2): always append a body-hash slice,
    // not just on the no-intent-id fallback. Two distinct events that
    // share (event, intent, status, created_at) — Ziina retries that
    // re-stamp `created_at` from the original PI rather than the event,
    // which the docs don't rule out — would otherwise collide on the
    // composite alone. Hashing the body forces them apart at the cost
    // of a few µs of SHA-256 per webhook. Slice short (16 hex = 64
    // bits) since the rest of the composite already carries entropy;
    // the body-hash is just a tie-breaker.
    const bodyHashTie = createHash('sha256')
      .update(input.body)
      .digest('hex')
      .slice(0, 16);
    const eventId = intentId
      ? `${eventName}:${intentId}:${statusKey}:${createdKey}:${bodyHashTie}`
      : `${eventName}:` +
        createHash('sha256').update(input.body).digest('hex').slice(0, 32);

    // For refund events the `id` is the refund's id, not the booking's PI.
    // The booking is keyed by `payment_intent_id`, so surface that as the
    // `providerPaymentId` so `findBookingByProviderPaymentId` can resolve it.
    const providerPaymentId = isRefundEvent
      ? payload.data?.payment_intent_id ?? payload.data?.id
      : payload.data?.id;

    return {
      eventId,
      eventType: payload.event ?? 'unknown',
      providerPaymentId,
      providerAccountId: payload.data?.account_id,
      status,
      amountReceivedMinorUnits: amountReceived,
      currency,
      refundStatus,
      refundAmountMinor,
      data: payload,
    };
  },
};
