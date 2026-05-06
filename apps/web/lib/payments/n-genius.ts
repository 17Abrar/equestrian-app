import { createHash, timingSafeEqual } from 'node:crypto';
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
  safeProviderPreview,
} from './types';

/**
 * N-Genius (Network International) adapter — UAE's dominant card acquirer.
 *
 * Source of truth:
 *   https://docs.ngenius-payments.com/reference/request-an-access-token-paypage
 *   https://docs.ngenius-payments.com/reference/create-an-order-paypage
 *   https://docs.ngenius-payments.com/reference/consuming-web-hooks
 *
 * ─ Connect flow: merchant generates a Service Account API key at Settings >
 *   Integration > Service Accounts, and reads their outlet reference at
 *   Settings > Organizational Hierarchy. Some tenants also require a
 *   realmName for the identity exchange (varies by merchant).
 * ─ Auth: POST `/identity/auth/access-token` with `Authorization: Basic <api-key>`
 *   — the API key is passed AS-IS (not base64-encoded, non-standard). The
 *   response `access_token` is a Bearer JWT valid for ~5 minutes.
 * ─ Create order: POST `/transactions/outlets/{outletRef}/orders` with
 *   `application/vnd.ni-payment.v2+json`. Amount is in minor units.
 * ─ Webhook verification: N-Genius does NOT sign payloads with HMAC. Instead,
 *   the merchant configures a custom header (e.g. `X-Webhook-Token`) with a
 *   secret value; N-Genius echoes that header on every delivery. We compare
 *   the incoming header value against the stored secret in constant time.
 */

const API_BASE_URL =
  process.env.N_GENIUS_API_BASE_URL ?? 'https://api-gateway.ngenius-payments.com';

const nGeniusCredentialsSchema = z.object({
  apiKey: z.string().min(1),
  outletReference: z.string().min(1),
  /** Tenant realm — required by some merchant configurations, omitted by others. */
  realmName: z.string().min(1).optional(),
  /** Name of the custom header the merchant configured in the portal (e.g. `X-Webhook-Token`). */
  webhookHeaderName: z.string().min(1).optional(),
  /** Secret value that N-Genius will echo in the configured header on each delivery. */
  webhookHeaderValue: z.string().min(1).optional(),
  /**
   * Audit LOW (2026-05-06): the outlet's settlement currency. The
   * previous shape hardcoded 'AED' at connect time, which would
   * silently 422 every payment for a non-AED merchant (e.g. a Saudi
   * operator on SAR) until support intervened. Capture it from the
   * connect form so the per-payment currency-parity check
   * (`bookings/[bookingId]/payment/route.ts`) can refuse early. ISO
   * 4217 3-letter codes; defaults to 'AED' when omitted to preserve
   * the dominant-tenant default without a UI break.
   */
  defaultCurrency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code (e.g. AED, SAR, KWD)')
    .default('AED'),
});

type NGeniusCredentials = z.infer<typeof nGeniusCredentialsSchema>;

function parseCredentials(raw: unknown): NGeniusCredentials {
  const result = nGeniusCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      `N-Genius credentials are invalid: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

async function getAccessToken(creds: NGeniusCredentials): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/identity/auth/access-token`, {
    method: 'POST',
    headers: {
      // The API key is the credential directly — NOT base64-encoded.
      Authorization: `Basic ${creds.apiKey}`,
      'Content-Type': 'application/vnd.ni-identity.v1+json',
      Accept: 'application/vnd.ni-identity.v1+json',
    },
    body: creds.realmName ? JSON.stringify({ realmName: creds.realmName }) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PaymentProviderError(
      'AUTH_FAILED',
      `N-Genius auth failed (${res.status}): ${safeProviderPreview(text)}`,
      { retryable: res.status >= 500 || res.status === 429 },
    );
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new PaymentProviderError('AUTH_FAILED', 'N-Genius returned no access_token');
  }
  return json.access_token;
}

// Map N-Genius event names and payment states to our canonical statuses.
// Event names from the docs: AUTHORISED, CAPTURED, PURCHASED, REFUNDED,
// PARTIALLY_CAPTURED, PARTIALLY_REFUNDED, DECLINED, REVERSED, CANCELLED,
// AWAIT_3DS, etc.
function mapState(state: string | undefined): PaymentIntentStatus {
  switch (state) {
    case 'PURCHASED':
    case 'CAPTURED':
    case 'AUTHORISED':
    case 'PURCHASE':
    case 'PARTIALLY_CAPTURED':
      return 'succeeded';
    case 'FAILED':
    case 'DECLINED':
      return 'failed';
    case 'REVERSED':
    case 'CANCELLED':
      return 'cancelled';
    case 'AWAIT_3DS':
    case 'AWAITING_PARTIAL_AUTH_APPROVAL':
      return 'requires_action';
    case 'REFUNDED':
      // Full refund — webhook handler maps to `paymentStatus='refunded'`.
      return 'refunded';
    case 'PARTIALLY_REFUNDED':
      // Partial refund — distinct from full so the webhook handler can
      // increment `refundedAmountMinor` by the actual refund delta and
      // leave the booking in `partial` state. Audit C-1: previously this
      // mapped to `refunded` and overwrote the booking's running refund
      // total, making future refund attempts believe nothing was owed.
      return 'partial_refunded';
    case 'STARTED':
    default:
      return 'pending';
  }
}

// Orders and payments are the same nested shape in create/lookup/webhook
// responses. Extract the hosted payment page URL, reference, state, and —
// for refund-bearing events — the residual / total refunded amount.
function extractOrderFields(order: unknown): {
  reference: string | undefined;
  paymentUrl: string | undefined;
  state: string | undefined;
  amountValue: number | undefined;
  amountCurrency: string | undefined;
  /** Total refunded so far on this payment leg, in minor units. Present on
   *  REFUNDED / PARTIALLY_REFUNDED webhooks via `_embedded.payment[0].refunds`
   *  (sum) or `payment.amount.value - payment.outstandingAmount` per N-Genius
   *  docs. Undefined when not surfaced by the payload. */
  refundedTotalMinor: number | undefined;
  /** The most recent refund delta on this event, when N-Genius surfaces a
   *  per-refund object (REFUNDED events embed the refund as the latest
   *  entry in `payment.refunds`). Undefined for non-refund events. */
  lastRefundAmountMinor: number | undefined;
} {
  if (!order || typeof order !== 'object') {
    return {
      reference: undefined,
      paymentUrl: undefined,
      state: undefined,
      amountValue: undefined,
      amountCurrency: undefined,
      refundedTotalMinor: undefined,
      lastRefundAmountMinor: undefined,
    };
  }
  const o = order as {
    reference?: string;
    _embedded?: {
      payment?: Array<{
        state?: string;
        amount?: { value?: number; currencyCode?: string };
        outstandingAmount?: { value?: number };
        refundedAmount?: { value?: number };
        _links?: { payment?: { href?: string } };
        _embedded?: {
          // N-Genius nests refunds under 'cnp:refund' (or just 'refund' on
          // some payloads). Each entry has its own amount.value + state.
          'cnp:refund'?: Array<{
            state?: string;
            amount?: { value?: number };
            createdDate?: string;
          }>;
          refund?: Array<{
            state?: string;
            amount?: { value?: number };
            createdDate?: string;
          }>;
        };
      }>;
    };
  };
  const payment = o._embedded?.payment?.[0];
  const refunds =
    payment?._embedded?.['cnp:refund'] ?? payment?._embedded?.refund ?? [];

  // Sum of all successful (or pending) refund amounts on the payment leg.
  // N-Genius surfaces this via `payment.refundedAmount.value` on some
  // gateway versions; fall back to summing the embedded refunds list.
  let refundedTotalMinor: number | undefined;
  if (typeof payment?.refundedAmount?.value === 'number') {
    refundedTotalMinor = payment.refundedAmount.value;
  } else if (
    typeof payment?.amount?.value === 'number' &&
    typeof payment?.outstandingAmount?.value === 'number'
  ) {
    // outstanding = amount - refunded, when both are present.
    refundedTotalMinor = payment.amount.value - payment.outstandingAmount.value;
  } else if (refunds.length > 0) {
    refundedTotalMinor = refunds.reduce(
      (acc, r) => acc + (typeof r.amount?.value === 'number' ? r.amount.value : 0),
      0,
    );
  }

  // The most recently appended refund — by createdDate when available, else
  // the last array entry.
  let lastRefundAmountMinor: number | undefined;
  if (refunds.length > 0) {
    const sorted = [...refunds].sort((a, b) => {
      const at = a.createdDate ? Date.parse(a.createdDate) : 0;
      const bt = b.createdDate ? Date.parse(b.createdDate) : 0;
      return bt - at;
    });
    const latest = sorted[0];
    if (typeof latest?.amount?.value === 'number') {
      lastRefundAmountMinor = latest.amount.value;
    }
  }

  return {
    reference: o.reference,
    paymentUrl: payment?._links?.payment?.href,
    state: payment?.state,
    amountValue: payment?.amount?.value,
    amountCurrency: payment?.amount?.currencyCode,
    refundedTotalMinor,
    lastRefundAmountMinor,
  };
}

export const nGeniusAdapter: PaymentProviderAdapter = {
  name: 'n_genius',
  displayName: 'N-Genius (Network International)',

  async connectWithCredentials(input: DirectConnectInput): Promise<DirectConnectResult> {
    const creds = parseCredentials({
      apiKey: input.credentials.apiKey,
      outletReference: input.credentials.outletReference,
      realmName: input.credentials.realmName,
      webhookHeaderName: input.credentials.webhookHeaderName,
      webhookHeaderValue: input.credentials.webhookHeaderValue,
      // Audit LOW (2026-05-06): default to AED at the schema level
      // when the connect form omits this — preserves the existing UX
      // for the dominant-tenant default without breaking the form for
      // operators who haven't ship the currency dropdown yet. SAR /
      // KWD / etc. operators pass it explicitly.
      defaultCurrency: input.credentials.defaultCurrency,
    });

    // Round-trip the key against the identity endpoint so we reject bad
    // credentials at connect-time instead of surfacing on the first payment.
    await getAccessToken(creds);

    return {
      externalAccountId: creds.outletReference,
      metadata: {
        apiBaseUrl: API_BASE_URL,
        hasRealmName: !!creds.realmName,
        hasWebhookHeader: !!(creds.webhookHeaderName && creds.webhookHeaderValue),
        webhookHeaderName: creds.webhookHeaderName ?? null,
        // Audit MED (2026-05-05 pass 2) + LOW (2026-05-06): record the
        // outlet's settlement currency so the booking-payment route's
        // currency-parity check
        // (`apps/web/app/api/v1/bookings/[bookingId]/payment/route.ts`)
        // can refuse to drive a payment in a currency the merchant
        // can't settle. The credential schema now captures this from
        // the connect form (defaulting to AED for the GCC dominant-
        // tenant case) — non-AED operators (SAR, KWD, etc.) pass it
        // explicitly.
        defaultCurrency: creds.defaultCurrency,
      },
      credentials: { ...creds },
    };
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const creds = parseCredentials(input.account.credentials);
    const accessToken = await getAccessToken(creds);

    // N-Genius limits orderReference to 35 chars alphanumeric.
    const orderReference = input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 35);

    const body = {
      action: 'SALE' as const,
      amount: {
        currencyCode: input.currency.toUpperCase(),
        value: input.amountMinorUnits,
      },
      merchantAttributes: {
        redirectUrl: input.returnUrl,
        cancelUrl: input.returnUrl,
        skipConfirmationPage: true,
      },
      emailAddress: input.metadata?.riderEmail,
      orderReference,
      language: 'en',
    };

    const res = await fetch(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.ni-payment.v2+json',
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaymentProviderError(
        'CREATE_PAYMENT_FAILED',
        `N-Genius order creation failed (${res.status}): ${safeProviderPreview(text)}`,
        { retryable: res.status >= 500 || res.status === 429 },
      );
    }

    const fields = extractOrderFields(await res.json());

    if (!fields.paymentUrl || !fields.reference) {
      throw new PaymentProviderError(
        'MALFORMED_RESPONSE',
        'N-Genius did not return a payment link and reference',
      );
    }

    return {
      flow: 'redirect',
      providerPaymentId: fields.reference,
      paymentUrl: fields.paymentUrl,
      status: mapState(fields.state),
    };
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const creds = parseCredentials(input.account.credentials);
    const accessToken = await getAccessToken(creds);

    // Look the order up to find the `_id` of the payment leg — refunds are
    // posted against a specific payment, not the order reference.
    const orderRes = await fetch(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
      },
    );

    if (!orderRes.ok) {
      throw new PaymentProviderError(
        'ORDER_LOOKUP_FAILED',
        `N-Genius order lookup failed (${orderRes.status})`,
      );
    }

    const order = (await orderRes.json()) as {
      _embedded?: {
        payment?: Array<{
          _id?: string;
          amount?: { value?: number; currencyCode?: string };
        }>;
      };
    };

    const payment = order._embedded?.payment?.[0];
    if (!payment?._id || !payment.amount) {
      throw new PaymentProviderError('NO_PAYMENT_LEG', 'N-Genius order has no capturable payment');
    }

    // Audit H-7: refuse the silent zero-amount fallback. Either an explicit
    // refund amount was passed, or N-Genius returned the original payment
    // amount on the order lookup. Anything else is a malformed lookup
    // response and must surface as a hard error rather than process a 0
    // refund (which N-Genius would accept, returning 200 with a $0 refund).
    const refundAmount = input.amountMinorUnits ?? payment.amount.value;
    if (refundAmount === undefined || refundAmount <= 0) {
      throw new PaymentProviderError(
        'INVALID_REFUND_AMOUNT',
        'N-Genius refund: no amount specified and original payment amount unavailable',
      );
    }

    const refundRes = await fetch(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}/payments/${encodeURIComponent(payment._id)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.ni-payment.v2+json',
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        body: JSON.stringify({
          amount: {
            currencyCode: payment.amount.currencyCode ?? 'AED',
            value: refundAmount,
          },
        }),
      },
    );

    if (!refundRes.ok) {
      const text = await refundRes.text().catch(() => '');
      throw new PaymentProviderError(
        'REFUND_FAILED',
        `N-Genius refund failed (${refundRes.status}): ${safeProviderPreview(text)}`,
      );
    }

    const refund = (await refundRes.json()) as { _id?: string; state?: string };

    return {
      providerRefundId: refund._id ?? `refund_${input.idempotencyKey}`,
      status:
        refund.state === 'SUCCESS' || refund.state === 'CAPTURED'
          ? 'succeeded'
          : refund.state === 'DECLINED' || refund.state === 'FAILED'
            ? 'failed'
            : 'pending',
    };
  },

  async getPaymentStatus(input: PaymentStatusInput): Promise<PaymentStatusResult> {
    const creds = parseCredentials(input.account.credentials);
    const accessToken = await getAccessToken(creds);

    const res = await fetch(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
      },
    );

    if (!res.ok) {
      throw new PaymentProviderError(
        'STATUS_LOOKUP_FAILED',
        `N-Genius status lookup failed (${res.status})`,
      );
    }

    const fields = extractOrderFields(await res.json());

    return {
      status: mapState(fields.state),
      amountReceivedMinorUnits: fields.amountValue ?? 0,
    };
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    // N-Genius does NOT sign webhook payloads. The merchant configures a
    // custom header (e.g. `X-Webhook-Token`) with a secret value in the
    // portal; N-Genius echoes that header on every delivery. The caller
    // (route handler) extracts the header value and passes it here; we
    // compare against the stored secret in constant time.
    //
    // Audit LOW (2026-05-05 pass 2): length-pad before compare. The
    // previous shape short-circuited on `a.length !== b.length`, leaking
    // the expected length to a timing attacker (probing different
    // payload lengths until the response time stops being constant).
    // The cron-secret compare elsewhere already pads; mirror it here so
    // an attacker can't measure the secret length even though the
    // residual is small (the secret value alone is the brute-force
    // surface, not its length, but defense-in-depth is cheap).
    const expected = input.webhookSecret;
    const provided = input.signatureHeader.trim();

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');

    // Pad the shorter buffer to the longer length with zero bytes; mark
    // the result invalid if the lengths differ. `timingSafeEqual`
    // requires equal-length inputs.
    const maxLen = Math.max(expectedBuf.length, providedBuf.length);
    const expectedPadded = Buffer.alloc(maxLen);
    expectedBuf.copy(expectedPadded);
    const providedPadded = Buffer.alloc(maxLen);
    providedBuf.copy(providedPadded);

    const equal =
      timingSafeEqual(expectedPadded, providedPadded) &&
      expectedBuf.length === providedBuf.length;

    if (!equal) {
      logger.warn('n_genius_webhook_header_mismatch');
      throw new PaymentProviderError(
        'INVALID_SIGNATURE',
        'N-Genius webhook header value did not match the stored secret',
      );
    }

    // Payload shape (from docs):
    //   { outletId, eventId, eventName, order: { reference, ... }, _embedded: { payment: [...] } }
    const payload = JSON.parse(input.body) as {
      outletId?: string;
      eventId?: string;
      eventName?: string;
      order?: unknown;
      // The webhook delivery time per N-Genius portal docs. Used as a
      // replay-window anchor so a captured (body, headerSecret) pair
      // can't be replayed weeks later. Audit B-13.
      paymentDate?: string;
      createdDateTime?: string;
    };

    // Replay-window enforcement (audit B-13). Reject events older than
    // ~10 minutes — N-Genius retries on bounded backoff so a legitimate
    // event won't take that long to land. The constant-time secret
    // compare is the primary defence; this is belt-and-braces against
    // a leaked secret + captured-body replay.
    const eventTime = payload.paymentDate ?? payload.createdDateTime;
    if (eventTime) {
      const eventMs = Date.parse(eventTime);
      if (Number.isFinite(eventMs)) {
        const ageMs = Date.now() - eventMs;
        if (ageMs > 10 * 60_000 || ageMs < -5 * 60_000) {
          logger.warn('n_genius_webhook_outside_freshness_window', { ageMs });
          throw new PaymentProviderError(
            'WEBHOOK_REPLAY',
            `N-Genius webhook outside freshness window (age=${ageMs}ms)`,
          );
        }
        // Audit F-13 (2026-05-06 r2): early-warning band. A drifting
        // Worker clock approaches the rejection thresholds silently —
        // operators only learn about it when webhooks start being
        // dropped. Surface a warn at >3min absolute drift so the
        // problem is visible BEFORE the freshness window catches it.
        if (Math.abs(ageMs) > 3 * 60_000) {
          logger.warn('n_genius_webhook_clock_drift_warning', {
            ageMs,
            note: 'Worker clock is drifting toward the freshness-window threshold; investigate before events start being rejected.',
          });
        }
      }
    }

    const fields = extractOrderFields(payload.order);

    // Deterministic fallback when payload.eventId is absent. Using
    // `ng_${Date.now()}` would give every redelivery a unique key, defeating
    // the webhook_events dedup table. Hash the stable composite so replays
    // resolve to the same id.
    //
    // Audit F-8 (2026-05-06 r2). Pre-fix the hash was just (outlet,
    // reference, eventName) — for partial-refund flows two distinct
    // events both carry `eventName='PARTIALLY_REFUNDED'` with the same
    // order reference, so the second event's derivedEventId collided
    // with the first and the dedup table silently dropped it. Now: also
    // include the event amount AND the most-recent refund amount when
    // the embedded refunds list surfaces it, so each refund leg gets a
    // distinct id. Also log `n_genius_event_id_derived` at warn so an
    // operator notices when N-Genius starts omitting `eventId` and can
    // request an integration update.
    let derivedEventId: string;
    if (payload.eventId) {
      derivedEventId = payload.eventId;
    } else {
      const composite = [
        payload.outletId ?? '',
        fields.reference ?? '',
        payload.eventName ?? '',
        fields.amountValue ?? '',
        fields.lastRefundAmountMinor ?? '',
        fields.refundedTotalMinor ?? '',
      ].join('|');
      derivedEventId =
        'ng_' +
        createHash('sha256').update(composite).digest('hex').slice(0, 24);
      logger.warn('n_genius_event_id_derived', {
        outletId: payload.outletId,
        reference: fields.reference,
        eventName: payload.eventName,
        amount: fields.amountValue,
        lastRefundAmount: fields.lastRefundAmountMinor,
        refundedTotal: fields.refundedTotalMinor,
      });
    }

    const status = mapState(payload.eventName ?? fields.state);
    // Audit F-4 (2026-05-06 comprehensive). Refund-amount surfacing
    // splits two paths so the webhook helper applies the right
    // semantics:
    //
    //   - `refundAmountMinor` is a DELTA (the value of the most recent
    //     refund entry). Used by the helper's per-event-delta branch
    //     to call `recordBookingRefund(delta)`. Only set when the
    //     embedded refunds list surfaced `lastRefundAmountMinor`.
    //
    //   - `refundCumulativeMinor` is the TOTAL refunded against the
    //     payment leg. Used by the helper's cumulative-to-delta
    //     branch (introduced in HIGH-3 for Stripe) to derive the
    //     correct delta from `cumulative - priorLedger`. Falls back
    //     here when the embedded refunds list is empty (some N-Genius
    //     gateway versions don't expand it on PARTIALLY_REFUNDED).
    //
    // The pre-fix code returned the cumulative total in
    // `refundAmountMinor`, which the helper treated as a delta and
    // double-counted on the second partial refund.
    const isRefundStatus = status === 'partial_refunded' || status === 'refunded';
    const refundAmountMinor = isRefundStatus
      ? fields.lastRefundAmountMinor
      : undefined;
    const refundCumulativeMinor =
      isRefundStatus && fields.lastRefundAmountMinor === undefined
        ? fields.refundedTotalMinor
        : undefined;

    return {
      eventId: derivedEventId,
      eventType: payload.eventName ?? 'order.update',
      providerPaymentId: fields.reference,
      // `outletId` scopes the event to a specific merchant outlet — that's
      // how we find the club row.
      providerAccountId: payload.outletId,
      // Map from the event name when present (more authoritative than
      // payment.state for transition events like REFUNDED).
      status,
      amountReceivedMinorUnits: fields.amountValue,
      currency: fields.amountCurrency?.toUpperCase(),
      refundAmountMinor,
      refundCumulativeMinor,
      // For partial refunds, signal `succeeded` so the webhook helper
      // can use `recordBookingRefund` (mirrors Stripe's path). Full
      // refund still goes through the existing `'refunded'` mapping.
      refundStatus: status === 'partial_refunded' ? 'succeeded' : undefined,
      data: payload,
    };
  },
};
