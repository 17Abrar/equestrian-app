import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { safeProviderPreview } from '@/lib/payments/types';
import { fetchProvider } from '@/lib/payments/provider-fetch';
import { toZiinaIdempotencyUuid } from '@/lib/payments/ziina-operation-id';

/**
 * Platform-billing Ziina helper. Uses Cavaliq's OWN Ziina merchant
 * account (the `PLATFORM_ZIINA_API_KEY` env secret) to issue payment
 * intents that bill clubs for their Cavaliq subscription.
 *
 * Distinct from `apps/web/lib/payments/ziina.ts`, which is the per-club
 * adapter — that adapter takes credentials from
 * `club_payment_accounts.encrypted_credentials` and runs payments under
 * the CLUB's Ziina account. This module talks to the platform's account
 * only and is used solely by the platform-billing cron + webhook receiver.
 */

const API_BASE_URL = process.env.ZIINA_API_BASE_URL ?? 'https://api-v2.ziina.com/api';

function getPlatformApiKey(): string {
  const key = process.env.PLATFORM_ZIINA_API_KEY;
  if (!key) {
    throw new PlatformZiinaError(
      'PROVIDER_NOT_CONFIGURED',
      'PLATFORM_ZIINA_API_KEY is not set — Cavaliq cannot bill subscriptions until this is configured.',
    );
  }
  return key;
}

// Audit F-39 (2026-05-07 r4): drive Ziina sandbox `test` flag from env so
// staging / preview workers can issue test payments. Defaults to live so
// production behavior is unchanged.
function isPlatformZiinaTestMode(): boolean {
  return process.env.PLATFORM_ZIINA_TEST_MODE === 'true';
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${getPlatformApiKey()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

export class PlatformZiinaError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(code: string, message: string, opts?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.name = 'PlatformZiinaError';
    if (opts?.cause) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface CreatePlatformPaymentIntentInput {
  amountMinorUnits: number;
  currency: string;
  /** Stable string normalized to Ziina's UUID `operation_id` for idempotent retries. */
  idempotencyKey: string;
  /** Human-readable line on the Ziina hosted page / receipt. */
  message: string;
  /** Where Ziina sends the browser after success/failure/cancel. */
  returnUrl: string;
}

export interface CreatePlatformPaymentIntentResult {
  /** Ziina's `payment_intent.id`. Persisted to the invoice as
   *  `provider_payment_id` so the webhook can resolve back to the row. */
  providerPaymentId: string;
  /** Hosted Ziina page the club admin opens to pay. */
  paymentUrl: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'requires_action';
}

function mapIntentStatus(status: string | undefined): CreatePlatformPaymentIntentResult['status'] {
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

/**
 * Issues a Ziina payment intent under Cavaliq's platform account. The
 * returned `paymentUrl` is the hosted page the club admin will load to
 * complete payment.
 */
export async function createPlatformPaymentIntent(
  input: CreatePlatformPaymentIntentInput,
): Promise<CreatePlatformPaymentIntentResult> {
  const res = await fetchProvider(
    `${API_BASE_URL}/payment_intent`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        operation_id: toZiinaIdempotencyUuid(input.idempotencyKey),
        amount: input.amountMinorUnits,
        currency_code: input.currency.toUpperCase(),
        message: input.message,
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        failure_url: input.returnUrl,
        // Audit F-39 (2026-05-07 r4): driven from env so staging can run
        // sandbox flows without a code change.
        test: isPlatformZiinaTestMode(),
      }),
    },
    { provider: 'Platform Ziina', operation: 'payment intent creation' },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PlatformZiinaError(
      res.status === 401 || res.status === 403 ? 'AUTH_FAILED' : 'CREATE_PAYMENT_FAILED',
      `Ziina platform payment-intent creation failed (${res.status}): ${safeProviderPreview(text)}`,
      { retryable: res.status >= 500 || res.status === 429 },
    );
  }

  const json = (await res.json()) as {
    id?: string;
    redirect_url?: string;
    status?: string;
  };

  if (!json.id || !json.redirect_url) {
    throw new PlatformZiinaError(
      'MALFORMED_RESPONSE',
      'Ziina did not return `id` and `redirect_url` for the platform intent',
    );
  }

  return {
    providerPaymentId: json.id,
    paymentUrl: json.redirect_url,
    status: mapIntentStatus(json.status),
  };
}

// ─── Webhook verification ─────────────────────────────────────────────

export interface PlatformWebhookEvent {
  /** Stable id we hand to `claimWebhookEvent` for dedup. Distinct from
   *  per-club Ziina event ids by virtue of the `ziina_platform` provider
   *  string used at claim time. */
  eventId: string;
  eventType: string;
  /** The Ziina payment intent id — matches `provider_payment_id` on the
   *  invoice row. */
  providerPaymentId: string | undefined;
  status: CreatePlatformPaymentIntentResult['status'];
  amountReceivedMinorUnits: number | undefined;
  currency: string | undefined;
}

export class PlatformWebhookError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlatformWebhookError';
  }
}

/**
 * Verifies the `X-Hmac-Signature` header against
 * `PLATFORM_ZIINA_WEBHOOK_SECRET` (set as a wrangler secret) and parses
 * the event envelope. Throws on signature mismatch — the route maps
 * that to a 401.
 */
export function verifyPlatformWebhook(input: {
  body: string;
  signatureHeader: string | null;
}): PlatformWebhookEvent {
  const secret = process.env.PLATFORM_ZIINA_WEBHOOK_SECRET;
  if (!secret) {
    throw new PlatformWebhookError('NOT_CONFIGURED', 'PLATFORM_ZIINA_WEBHOOK_SECRET is not set');
  }

  const providedRaw = (input.signatureHeader ?? '').trim();
  if (!providedRaw) {
    throw new PlatformWebhookError('INVALID_SIGNATURE', 'Missing X-Hmac-Signature');
  }

  const expected = createHmac('sha256', secret).update(input.body).digest('hex');
  // Tolerate the `sha256=` prefix some pipelines prepend, normalise case.
  const provided = providedRaw.replace(/^sha256=/i, '').toLowerCase();

  // Audit F-44 (2026-05-07 r4): length-pad before compare. The previous
  // shape short-circuited on `a.length !== b.length`, leaking the
  // expected length to a timing attacker probing different signature
  // lengths until the response time stops being constant. Mirror the
  // padding pattern from `n-genius.ts:506-517` so an attacker can't
  // measure the expected hex-digest length even though the residual is
  // small (`createHmac('sha256', ...).digest('hex')` is always 64 chars,
  // so the leak only matters if the platform secret ever migrates to a
  // different digest algorithm — defense-in-depth is cheap).
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  const maxLen = Math.max(expectedBuf.length, providedBuf.length);
  const expectedPadded = Buffer.alloc(maxLen);
  expectedBuf.copy(expectedPadded);
  const providedPadded = Buffer.alloc(maxLen);
  providedBuf.copy(providedPadded);

  const equal =
    timingSafeEqual(expectedPadded, providedPadded) && expectedBuf.length === providedBuf.length;
  if (!equal) {
    throw new PlatformWebhookError(
      'INVALID_SIGNATURE',
      'Platform Ziina webhook signature verification failed',
    );
  }

  // Parse the envelope. Ziina's shape is `{ event, data }` with the
  // PaymentIntent under `data` for `payment_intent.status.updated` events.
  let payload: {
    event?: string;
    data?: {
      id?: string;
      status?: string;
      amount?: number;
      currency_code?: string;
      created_at?: string;
    };
  };
  try {
    payload = JSON.parse(input.body);
  } catch {
    throw new PlatformWebhookError('INVALID_BODY', 'Webhook body is not valid JSON');
  }

  const status = mapIntentStatus(payload.data?.status);
  const intentId = payload.data?.id;
  const eventName = payload.event ?? 'ziina.event';
  const statusKey = payload.data?.status ?? 'nostatus';
  // Audit HIGH-7 (2026-05-05): include created_at in the dedup composite —
  // see the matching change in `lib/payments/ziina.ts`. Otherwise two
  // events sharing (event, intent_id, status) (possible on retries or
  // partial-refund oscillation) collide and the second is silently
  // `already_processed`.
  const createdKey =
    typeof payload.data?.created_at === 'string' ? payload.data.created_at : 'nots';

  // Audit LOW (2026-05-06 third pass): mirror the per-club ziina handler's
  // body-hash tie-breaker (`apps/web/lib/payments/ziina.ts`). Without it,
  // two events sharing `(event, intent_id, status, created_at)` collide
  // on the dedup composite and the second is silently
  // `already_processed`. 16-hex slice = 64 bits, sufficient when the
  // rest of the composite already carries entropy.
  const bodyHashTie = createHash('sha256').update(input.body).digest('hex').slice(0, 16);
  const eventId = intentId
    ? `${eventName}:${intentId}:${statusKey}:${createdKey}:${bodyHashTie}`
    : `${eventName}:` + createHash('sha256').update(input.body).digest('hex').slice(0, 32);

  return {
    eventId,
    eventType: eventName,
    providerPaymentId: intentId,
    status,
    amountReceivedMinorUnits:
      status === 'succeeded' && typeof payload.data?.amount === 'number'
        ? payload.data.amount
        : undefined,
    currency: payload.data?.currency_code?.toUpperCase(),
  };
}
