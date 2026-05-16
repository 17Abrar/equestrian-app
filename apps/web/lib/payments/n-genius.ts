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
import { fetchProvider } from './provider-fetch';

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

/**
 * Audit r6 F-39 (2026-05-08): per-credentials access-token cache. N-Genius
 * tokens are valid for ~5 minutes (per the docstring at the top of this
 * file); pre-fix every adapter method (`createPayment`, `refund`,
 * `getPaymentStatus`) called `getAccessToken` fresh, costing one identity
 * round-trip per call. Material for cron runs that drive 50 invoices through
 * one outlet — that's 50 redundant identity exchanges.
 *
 * TTL: 4 minutes, leaving a 60s buffer so an in-flight cached token doesn't
 * expire mid-request.
 *
 * Cache key: SHA-256 of the normalized credentials. We hash rather than
 * concatenating plaintext so a heap dump of the worker doesn't surface
 * raw API keys. The hash is stable across calls with the same credentials
 * (key derivation only reads the fields that affect the auth response —
 * apiKey + realmName; outlet/webhook fields don't influence token issuance).
 *
 * Module-scope `Map` is shared across requests in the same Worker isolate.
 * On Cloudflare Workers each isolate has its own memory and the eviction
 * happens via TTL expiry; no LRU bound is needed because the cardinality is
 * `unique-credential-hashes-per-isolate` — at the 50-club scale that's tiny.
 */
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_TTL_MS = 4 * 60 * 1000;

function hashCredentials(creds: NGeniusCredentials): string {
  return createHash('sha256')
    .update(creds.apiKey)
    .update('|')
    .update(creds.realmName ?? '')
    .digest('hex');
}

async function getAccessToken(creds: NGeniusCredentials): Promise<string> {
  const cacheKey = hashCredentials(creds);
  const now = Date.now();
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const res = await fetchProvider(
    `${API_BASE_URL}/identity/auth/access-token`,
    {
      method: 'POST',
      headers: {
        // The API key is the credential directly — NOT base64-encoded.
        Authorization: `Basic ${creds.apiKey}`,
        'Content-Type': 'application/vnd.ni-identity.v1+json',
        Accept: 'application/vnd.ni-identity.v1+json',
      },
      body: creds.realmName ? JSON.stringify({ realmName: creds.realmName }) : undefined,
    },
    { provider: 'N-Genius', operation: 'access token request' },
  );

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
  accessTokenCache.set(cacheKey, {
    token: json.access_token,
    expiresAt: now + TOKEN_TTL_MS,
  });
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
  /** Audit F-22 / F-24 (2026-05-07 r5): the description we stamped at
   *  create-time in `merchantAttributes.cavaliqDescription`. N-Genius
   *  echoes merchantAttributes back in webhook order payloads. The
   *  webhook helper parses `[booking:UUID]` from this for fast-succeed
   *  recovery. */
  cavaliqDescription: string | undefined;
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
      cavaliqDescription: undefined,
    };
  }
  // N-Genius v2 PayPage responses do NOT consistently expose the hosted-page
  // URL at the same `_links` key. Production traffic (Sentry event
  // `30779906d169...`, 2026-05-16) returned an HTTP 201 Created order with
  // `_links` containing only `cancel` + `cnp:payment-link` at the order level,
  // and the hosted URL sitting inside `_embedded.payment[0]._links` under a
  // colon-namespaced key — `payment:hosted` in current paypage docs, `payment`
  // in older gateway versions. The pre-fix parser read only
  // `_embedded.payment[0]._links.payment.href` and threw MALFORMED_RESPONSE on
  // every modern paypage response.
  //
  // The `_links` types below intentionally enumerate every link key we've
  // observed in v2 paypage responses so a future drift surfaces as a TS error
  // at the lookup table, not a silent miss. The actual lookup is done with a
  // candidate-key sweep (see `paymentUrl` below) so we don't depend on which
  // single key the merchant outlet's gateway version chose.
  type NGeniusLinks = {
    payment?: { href?: string };
    'payment:hosted'?: { href?: string };
    'payment-page'?: { href?: string };
    'payment-authorization'?: { href?: string };
    'cnp:payment-link'?: { href?: string };
    'cnp:hosted-payment'?: { href?: string };
  };
  const o = order as {
    reference?: string;
    merchantAttributes?: { cavaliqDescription?: string };
    _links?: NGeniusLinks;
    _embedded?: {
      payment?: Array<{
        state?: string;
        amount?: { value?: number; currencyCode?: string };
        outstandingAmount?: { value?: number };
        refundedAmount?: { value?: number };
        _links?: NGeniusLinks;
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
  const refunds = payment?._embedded?.['cnp:refund'] ?? payment?._embedded?.refund ?? [];

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

  // Candidate sweep across every link key shape we've seen in v2 paypage
  // responses, embedded payment leg first (where the hosted URL canonically
  // lives), order-level as a fallback. First non-empty wins. See the
  // `NGeniusLinks` type above for the keys we enumerate; if N-Genius starts
  // returning a new key we'll see it surface in `availableLinkKeys` on the
  // MALFORMED_RESPONSE log path.
  const linkCandidates: Array<string | undefined> = [
    payment?._links?.payment?.href,
    payment?._links?.['payment:hosted']?.href,
    payment?._links?.['payment-page']?.href,
    payment?._links?.['payment-authorization']?.href,
    o._links?.payment?.href,
    o._links?.['payment:hosted']?.href,
    o._links?.['payment-page']?.href,
    o._links?.['payment-authorization']?.href,
    o._links?.['cnp:hosted-payment']?.href,
  ];
  const paymentUrl = linkCandidates.find((u) => typeof u === 'string' && u.length > 0);

  return {
    reference: o.reference,
    paymentUrl,
    state: payment?.state,
    amountValue: payment?.amount?.value,
    amountCurrency: payment?.amount?.currencyCode,
    refundedTotalMinor,
    lastRefundAmountMinor,
    cavaliqDescription: o.merchantAttributes?.cavaliqDescription,
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

    // N-Genius limits orderReference to 35 chars alphanumeric. The
    // booking-payment route builds the idempotencyKey as
    // `booking_<uuid>_<currency>_<amount>` — once non-alphanumerics
    // are stripped the prefix + UUID hex alone is ~39 chars, so the
    // pre-fix `slice(0, 35)` lopped the currency and amount off the
    // end. Two attempts on the same booking at different post-coupon
    // amounts then collided on orderReference; N-Genius replayed the
    // original (often stale) order without a fresh PayPage link,
    // surfacing as MALFORMED_RESPONSE downstream. (2026-05-15.)
    //
    // Hash to 32 hex chars so each (booking, currency, amount) tuple
    // maps to a unique reference. Deterministic — repeat calls with
    // the same idempotency key still hit N-Genius's order-level
    // idempotency.
    const orderReference = createHash('sha256')
      .update(input.idempotencyKey)
      .digest('hex')
      .slice(0, 32);

    // Audit F-22 / F-24 (2026-05-07 r5): N-Genius echoes
    // `merchantAttributes` in webhook order payloads. Pass the full
    // description (which the booking-payment route stamps with a
    // `[booking:UUID]` marker) through a custom attribute so the
    // webhook helper can recover the bookingId on the instant-succeed
    // race window where `setBookingPaymentRef` hasn't yet written the
    // provider_payment_id back to the booking row. Stays in
    // `merchantAttributes` (a free-form bag the merchant owns) rather
    // than `description` (which N-Genius doesn't define on the order
    // create body for v2). Truncate to 200 chars to stay well under
    // any realistic gateway limit; the marker fits in the first 80.
    const cavaliqDescription = input.description?.slice(0, 200);
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
        ...(cavaliqDescription ? { cavaliqDescription } : {}),
      },
      emailAddress: input.metadata?.riderEmail,
      orderReference,
      language: 'en',
    };

    const res = await fetchProvider(
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
      { provider: 'N-Genius', operation: 'order creation' },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaymentProviderError(
        'CREATE_PAYMENT_FAILED',
        `N-Genius order creation failed (${res.status}): ${safeProviderPreview(text)}`,
        { retryable: res.status >= 500 || res.status === 429 },
      );
    }

    const rawJson = (await res.json()) as unknown;
    const fields = extractOrderFields(rawJson);

    if (!fields.paymentUrl || !fields.reference) {
      // 2026-05-15 / 2026-05-16: the first revision of this log told us
      // N-Genius returns 201 Created with `_links` + `_embedded` but no
      // payment URL matched any candidate (see `linkCandidates` sweep in
      // extractOrderFields). Surface the `_links` key NAMES at both order
      // and embedded levels so the next failure pinpoints the missing
      // key without another deploy round-trip. Preview cap raised to
      // 2000 chars — `safeProviderPreview` scrubs card-shaped digits +
      // emails, and N-Genius order bodies don't carry rider PII beyond
      // what we already send in `emailAddress`.
      const rawObj =
        rawJson && typeof rawJson === 'object' ? (rawJson as Record<string, unknown>) : null;
      const orderLinksObj =
        rawObj && typeof rawObj._links === 'object' && rawObj._links !== null
          ? (rawObj._links as Record<string, unknown>)
          : null;
      const embeddedPayment =
        rawObj &&
        typeof rawObj._embedded === 'object' &&
        rawObj._embedded !== null &&
        Array.isArray((rawObj._embedded as { payment?: unknown }).payment)
          ? ((rawObj._embedded as { payment: unknown[] }).payment[0] as
              | Record<string, unknown>
              | undefined)
          : undefined;
      const embeddedPaymentLinksObj =
        embeddedPayment &&
        typeof embeddedPayment._links === 'object' &&
        embeddedPayment._links !== null
          ? (embeddedPayment._links as Record<string, unknown>)
          : null;

      logger.error('n_genius_create_payment_malformed', {
        httpStatus: res.status,
        orderReference,
        bookingId: input.bookingId,
        clubId: input.clubId,
        currency: input.currency,
        amountMinorUnits: input.amountMinorUnits,
        hasReference: !!fields.reference,
        hasPaymentUrl: !!fields.paymentUrl,
        orderLinkKeys: orderLinksObj ? Object.keys(orderLinksObj) : [],
        embeddedPaymentLinkKeys: embeddedPaymentLinksObj
          ? Object.keys(embeddedPaymentLinksObj)
          : [],
        responsePreview: safeProviderPreview(JSON.stringify(rawJson ?? null), 2000),
        responseKeys: rawObj ? Object.keys(rawObj) : [],
      });
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
    const orderRes = await fetchProvider(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
      },
      { provider: 'N-Genius', operation: 'order lookup' },
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
          state?: string;
          amount?: { value?: number; currencyCode?: string };
          outstandingAmount?: { value?: number };
        }>;
      };
      outstandingAmount?: { value?: number };
    };

    // Audit F-45 (2026-05-07 r5): pre-fix this took `payment[0]`
    // unconditionally. N-Genius orders can carry multiple payments
    // (split-tender, retries-after-decline) and array order isn't
    // documented as deterministic. Refunding the wrong leg returned
    // 200 SUCCESS against a $0-or-already-refunded payment with no
    // post-refund reconciliation.
    //
    // The correct SALE leg is the most recent CAPTURED / PURCHASED /
    // PURCHASE entry — if a refund amount was specified by the
    // caller, prefer the entry whose `amount.value` matches (split-
    // tender disambiguation). Falls back to the most-recent eligible
    // entry when no exact match exists. Throws if nothing matches.
    const ELIGIBLE_PAYMENT_STATES = new Set(['CAPTURED', 'PURCHASED', 'PURCHASE']);
    const eligiblePayments = (order._embedded?.payment ?? []).filter(
      (p) => p?._id && p?.amount && p.state && ELIGIBLE_PAYMENT_STATES.has(p.state),
    );
    if (eligiblePayments.length === 0) {
      throw new PaymentProviderError(
        'NO_PAYMENT_LEG',
        'N-Genius order has no captured / purchased payment leg to refund',
      );
    }
    // When the caller passed an explicit amount, prefer the entry that
    // matches (split-tender disambiguation: $30 + $20 captures, refund
    // request for $20 should hit the $20 leg, not the $30).
    const explicitMatch = input.amountMinorUnits
      ? eligiblePayments.find((p) => p.amount?.value === input.amountMinorUnits)
      : undefined;
    // Fall back to the LAST eligible entry — newest-first per N-Genius
    // documented retry-after-decline behavior, where the array grows
    // over time. Belt-and-braces: if the array is mid-mutation server-
    // side, the last entry is the most-recently committed one.
    const payment = explicitMatch ?? eligiblePayments[eligiblePayments.length - 1];
    if (!payment || !payment._id || !payment.amount) {
      throw new PaymentProviderError('NO_PAYMENT_LEG', 'N-Genius order has no capturable payment');
    }
    const preRefundOutstanding =
      typeof order.outstandingAmount?.value === 'number'
        ? order.outstandingAmount.value
        : typeof payment.outstandingAmount?.value === 'number'
          ? payment.outstandingAmount.value
          : undefined;

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

    // Audit F-41 (2026-05-07 r4): hard-fail when the original payment is
    // missing a currencyCode. The previous silent default to 'AED' would
    // mis-issue refunds for SAR/KWD/etc. merchants whose order lookup
    // returned a malformed payload. Forcing the operator to investigate is
    // safer than crediting the wrong currency.
    const refundCurrencyCode = payment.amount.currencyCode;
    if (!refundCurrencyCode) {
      throw new PaymentProviderError(
        'REFUND_NO_CURRENCY',
        'N-Genius refund: original payment lookup returned no currency code; refusing to default.',
      );
    }

    const refundRes = await fetchProvider(
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
            currencyCode: refundCurrencyCode,
            value: refundAmount,
          },
        }),
      },
      { provider: 'N-Genius', operation: 'refund creation' },
    );

    if (!refundRes.ok) {
      const text = await refundRes.text().catch(() => '');
      // Audit F-10 (2026-05-08 r6): mark 5xx / 429 retryable so the
      // route's `withProviderRetry` wrapper actually re-attempts.
      // Mirrors `createPayment` posture at line 368.
      throw new PaymentProviderError(
        'REFUND_FAILED',
        `N-Genius refund failed (${refundRes.status}): ${safeProviderPreview(text)}`,
        { retryable: refundRes.status >= 500 || refundRes.status === 429 },
      );
    }

    const refund = (await refundRes.json()) as { _id?: string; state?: string };

    // Audit F-45 (2026-05-07 r5): post-refund reconciliation. After
    // we've issued the refund, fetch the order again and assert that
    // `outstandingAmount` decreased by at least `refundAmount`.
    // Without this, a successful HTTP 200 from N-Genius against a
    // mis-targeted leg (somehow past the filter above — partial-
    // capture edge cases) silently records a $0 refund. Best-effort:
    // a failure here doesn't roll back the refund (we can't, the
    // money is already gone) but logs loudly so an operator can
    // reconcile.
    if (
      preRefundOutstanding !== undefined &&
      (refund.state === 'SUCCESS' || refund.state === 'CAPTURED')
    ) {
      try {
        const reconcileRes = await fetchProvider(
          `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.ni-payment.v2+json',
            },
          },
          { provider: 'N-Genius', operation: 'refund reconciliation lookup' },
        );
        if (reconcileRes.ok) {
          const reconcileOrder = (await reconcileRes.json()) as {
            outstandingAmount?: { value?: number };
            _embedded?: {
              payment?: Array<{
                outstandingAmount?: { value?: number };
              }>;
            };
          };
          const postOutstanding =
            typeof reconcileOrder.outstandingAmount?.value === 'number'
              ? reconcileOrder.outstandingAmount.value
              : typeof reconcileOrder._embedded?.payment?.[0]?.outstandingAmount?.value === 'number'
                ? reconcileOrder._embedded.payment[0].outstandingAmount.value
                : undefined;
          if (postOutstanding !== undefined) {
            const delta = preRefundOutstanding - postOutstanding;
            if (delta < refundAmount) {
              logger.error('n_genius_refund_outstanding_did_not_decrease', {
                providerPaymentId: input.providerPaymentId,
                paymentLegId: payment._id,
                requestedRefund: refundAmount,
                preOutstanding: preRefundOutstanding,
                postOutstanding,
                delta,
              });
            }
          }
        }
      } catch (err) {
        logger.warn('n_genius_refund_reconcile_lookup_failed', {
          providerPaymentId: input.providerPaymentId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

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

    const res = await fetchProvider(
      `${API_BASE_URL}/transactions/outlets/${encodeURIComponent(creds.outletReference)}/orders/${encodeURIComponent(input.providerPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
      },
      { provider: 'N-Genius', operation: 'payment status lookup' },
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
      timingSafeEqual(expectedPadded, providedPadded) && expectedBuf.length === providedBuf.length;

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
    // ~90 seconds — N-Genius retries on bounded backoff so a legitimate
    // event won't take that long to land, and Stripe's documented signed-
    // webhook tolerance is 5 min (we go tighter because the
    // payload-controlled `eventTime` field below is the attacker's own
    // surface, not a server-stamped timestamp). The constant-time
    // secret compare is the primary defence; this is belt-and-braces
    // against a leaked secret + captured-body replay.
    //
    // Audit F-20 (2026-05-07 r5): tightened from 10 min → 90 s. N-Genius
    // does NOT HMAC-sign the body — they echo a shared secret in a
    // custom header. A leaked (header, body) pair captured from a
    // legitimate delivery can be replayed to forge events for arbitrary
    // references. The 10-min window was generous enough to cover
    // realistic attack scenarios. 90 s tracks Stripe parity; the
    // payload-controlled `eventTime` means this is defense-in-depth,
    // not a hard auth boundary.
    const FRESHNESS_WINDOW_MS = 90 * 1_000;
    // The negative-side window (clock skew) stays at 5 min — N-Genius
    // can stamp eventTime up to a few seconds in the future and a
    // Worker clock drift in either direction shouldn't reject
    // legitimate deliveries.
    const FUTURE_SKEW_MS = 5 * 60_000;
    const eventTime = payload.paymentDate ?? payload.createdDateTime;
    if (eventTime) {
      const eventMs = Date.parse(eventTime);
      if (Number.isFinite(eventMs)) {
        const ageMs = Date.now() - eventMs;
        if (ageMs > FRESHNESS_WINDOW_MS || ageMs < -FUTURE_SKEW_MS) {
          logger.warn('n_genius_webhook_outside_freshness_window', { ageMs });
          throw new PaymentProviderError(
            'WEBHOOK_REPLAY',
            `N-Genius webhook outside freshness window (age=${ageMs}ms)`,
          );
        }
        // Audit F-13 (2026-05-06 r2): early-warning band. A drifting
        // Worker clock approaches the rejection thresholds silently —
        // operators only learn about it when webhooks start being
        // dropped. Surface a warn at >50% of the freshness window so
        // the problem is visible BEFORE the freshness window catches
        // it.
        if (Math.abs(ageMs) > FRESHNESS_WINDOW_MS / 2) {
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
      derivedEventId = 'ng_' + createHash('sha256').update(composite).digest('hex').slice(0, 24);
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
    const refundAmountMinor = isRefundStatus ? fields.lastRefundAmountMinor : undefined;
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
      // Audit F-22 / F-24 (2026-05-07 r5): defense-in-depth recovery
      // path — see types.ts WebhookEvent.descriptionForRecovery.
      descriptionForRecovery: fields.cavaliqDescription,
      data: payload,
    };
  },
};
