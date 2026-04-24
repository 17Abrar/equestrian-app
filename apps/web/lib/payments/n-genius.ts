import { createHash, timingSafeEqual } from 'node:crypto';
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

interface NGeniusCredentials {
  apiKey: string;
  outletReference: string;
  /** Tenant realm — required by some merchant configurations, omitted by others. */
  realmName?: string;
  /** Name of the custom header the merchant configured in the portal (e.g. `X-Webhook-Token`). */
  webhookHeaderName?: string;
  /** Secret value that N-Genius will echo in the configured header on each delivery. */
  webhookHeaderValue?: string;
}

function parseCredentials(raw: unknown): NGeniusCredentials {
  if (!raw || typeof raw !== 'object') {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      'N-Genius credentials are missing or malformed',
    );
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.apiKey !== 'string' || c.apiKey.length === 0) {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      'N-Genius credentials must include `apiKey`',
    );
  }
  if (typeof c.outletReference !== 'string' || c.outletReference.length === 0) {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      'N-Genius credentials must include `outletReference`',
    );
  }
  return {
    apiKey: c.apiKey,
    outletReference: c.outletReference,
    realmName: typeof c.realmName === 'string' ? c.realmName : undefined,
    webhookHeaderName:
      typeof c.webhookHeaderName === 'string' ? c.webhookHeaderName : undefined,
    webhookHeaderValue:
      typeof c.webhookHeaderValue === 'string' ? c.webhookHeaderValue : undefined,
  };
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
      `N-Genius auth failed (${res.status}): ${text.slice(0, 200)}`,
      { retryable: res.status >= 500 },
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
    case 'PARTIALLY_REFUNDED':
      // Post-settlement refund — from the rider's perspective the original
      // payment still succeeded; refund events are tracked separately.
      return 'succeeded';
    case 'STARTED':
    default:
      return 'pending';
  }
}

// Orders and payments are the same nested shape in create/lookup/webhook
// responses. Extract the hosted payment page URL, reference, and state.
function extractOrderFields(order: unknown): {
  reference: string | undefined;
  paymentUrl: string | undefined;
  state: string | undefined;
  amountValue: number | undefined;
  amountCurrency: string | undefined;
} {
  if (!order || typeof order !== 'object') {
    return {
      reference: undefined,
      paymentUrl: undefined,
      state: undefined,
      amountValue: undefined,
      amountCurrency: undefined,
    };
  }
  const o = order as {
    reference?: string;
    _embedded?: {
      payment?: Array<{
        state?: string;
        amount?: { value?: number; currencyCode?: string };
        _links?: { payment?: { href?: string } };
      }>;
    };
  };
  const payment = o._embedded?.payment?.[0];
  return {
    reference: o.reference,
    paymentUrl: payment?._links?.payment?.href,
    state: payment?.state,
    amountValue: payment?.amount?.value,
    amountCurrency: payment?.amount?.currencyCode,
  };
}

export const nGeniusAdapter: PaymentProviderAdapter = {
  name: 'n_genius',
  connectMode: 'api_key',
  displayName: 'N-Genius (Network International)',

  async connectWithCredentials(input: DirectConnectInput): Promise<DirectConnectResult> {
    const creds = parseCredentials({
      apiKey: input.credentials.apiKey,
      outletReference: input.credentials.outletReference,
      realmName: input.credentials.realmName,
      webhookHeaderName: input.credentials.webhookHeaderName,
      webhookHeaderValue: input.credentials.webhookHeaderValue,
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
        `N-Genius order creation failed (${res.status}): ${text.slice(0, 200)}`,
        { retryable: res.status >= 500 },
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

    const refundAmount = input.amountMinorUnits ?? payment.amount.value ?? 0;

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
        `N-Genius refund failed (${refundRes.status}): ${text.slice(0, 200)}`,
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
    const expected = input.webhookSecret;
    const provided = input.signatureHeader.trim();

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
    };

    const fields = extractOrderFields(payload.order);

    // Deterministic fallback when payload.eventId is absent. Using
    // `ng_${Date.now()}` would give every redelivery a unique key, defeating
    // the webhook_events dedup table. Hash the stable triple (outlet, order
    // reference, event name) so replays resolve to the same id.
    const derivedEventId =
      payload.eventId ??
      'ng_' +
        createHash('sha256')
          .update(
            `${payload.outletId ?? ''}|${fields.reference ?? ''}|${payload.eventName ?? ''}`,
          )
          .digest('hex')
          .slice(0, 24);

    return {
      eventId: derivedEventId,
      eventType: payload.eventName ?? 'order.update',
      providerPaymentId: fields.reference,
      // `outletId` scopes the event to a specific merchant outlet — that's
      // how we find the club row.
      providerAccountId: payload.outletId,
      // Map from the event name when present (more authoritative than
      // payment.state for transition events like REFUNDED).
      status: mapState(payload.eventName ?? fields.state),
      amountReceivedMinorUnits: fields.amountValue,
      data: payload,
    };
  },
};
