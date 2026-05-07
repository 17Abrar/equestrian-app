import type {
  PaymentProvider as ProviderName,
  PaymentAccountWithCredentials,
  DecryptedCredentials,
} from '@equestrian/db/queries';

export type { ProviderName, PaymentAccountWithCredentials, DecryptedCredentials };

export type PaymentIntentStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  // Post-settlement refund. Adapters that surface refund events through the
  // webhook stream (N-Genius `REFUNDED`, Ziina `refund.status.updated`) map
  // to this directly; Stripe handles refunds through a separate code path.
  | 'refunded'
  // Partial post-settlement refund. Distinct from `refunded` so the webhook
  // handler can call `recordBookingRefund(amount)` with the correct delta
  // and leave the booking in `partial` state — overwriting to `refunded`
  // when the rider is owed more would corrupt the ledger (audit C-1).
  | 'partial_refunded';

export interface CreatePaymentInput {
  account: PaymentAccountWithCredentials;
  amountMinorUnits: number;
  currency: string;
  bookingId: string;
  riderId: string;
  clubId: string;
  description?: string;
  metadata?: Record<string, string>;
  /** Where the provider redirects the customer after hosted-payment-page flows. */
  returnUrl: string;
  /** Stable key for idempotent retries against the provider. */
  idempotencyKey: string;
}

export type CreatePaymentResult =
  | {
      flow: 'inline';
      providerPaymentId: string;
      /** Returned by Stripe to mount Elements client-side. */
      clientSecret: string;
      /**
       * Stripe publishable key for THIS club. The pay dialog calls
       * `loadStripe(publishableKey)` with this. Per-club because each
       * stable runs Stripe under their own merchant account — there's
       * no platform-level publishable key.
       */
      publishableKey: string;
      status: PaymentIntentStatus;
    }
  | {
      flow: 'redirect';
      providerPaymentId: string;
      /** Hosted payment page URL — browser is redirected here. */
      paymentUrl: string;
      status: PaymentIntentStatus;
    };

export interface RefundInput {
  account: PaymentAccountWithCredentials;
  providerPaymentId: string;
  /** Omit for a full refund; specify to refund partial amount. */
  amountMinorUnits?: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentStatusInput {
  account: PaymentAccountWithCredentials;
  providerPaymentId: string;
}

export interface PaymentStatusResult {
  status: PaymentIntentStatus;
  /** Captured amount in minor units. `undefined` when the intent is in a
   * non-terminal state (pending/requires_action) — a future booking-
   * reconciliation path that compares this against booking.amount would
   * otherwise treat requires_action as "0 received" and downgrade the
   * booking ledger. Audit AI-32e. */
  amountReceivedMinorUnits: number | undefined;
}

// ─── Connection (direct API key) — every provider ─────────────────────
//
// Every supported provider — Stripe, N-Genius, Ziina — uses per-club
// credentials pasted into the settings form (Stripe Connect / OAuth was
// removed when we shifted to a non-platform model where each stable
// runs payments under their own merchant account).

export interface DirectConnectInput {
  clubId: string;
  /** Provider-specific key/value pairs supplied by the merchant in the settings form. */
  credentials: Record<string, string>;
}

export interface DirectConnectResult {
  externalAccountId: string;
  metadata: Record<string, unknown>;
  credentials: DecryptedCredentials;
}

// ─── Webhooks ─────────────────────────────────────────────────────────

export interface VerifyWebhookInput {
  body: string;
  signatureHeader: string;
  webhookSecret: string;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  providerPaymentId?: string;
  /**
   * The provider's identifier for the merchant account the event is scoped to
   * — Stripe `connected_account_id`, N-Genius `outletId`, Ziina `account_id`.
   * Webhook routes use this to resolve which club the event belongs to.
   */
  providerAccountId?: string;
  /**
   * The booking id we set in the payment's metadata when creating the intent.
   * Populated by adapters whose providers carry arbitrary metadata through to
   * webhooks (Stripe). Used to close a race where a webhook arrives between
   * `adapter.createPayment` returning and the route storing the generated
   * `providerPaymentId` on the booking: the `providerPaymentId` lookup fails,
   * but we can still resolve the booking via this field.
   */
  bookingId?: string;
  status?: PaymentIntentStatus;
  amountReceivedMinorUnits?: number;
  /**
   * ISO-4217 code reported by the provider for this charge. Compared
   * against booking.currency in webhook-helpers.ts before flipping
   * paymentStatus='paid'. Required on succeeded events for stripe/ziina/
   * n_genius adapters; undefined on refund-only charge.refund.updated
   * events. Audit AI-21.
   */
  currency?: string;
  /**
   * For refund events that carry a refund-object lifecycle (Stripe
   * `charge.refund.updated`), the refund's own status. Distinct from
   * `status` (which models the parent payment intent) because a refund
   * can transition `pending → succeeded` OR `pending → failed`. When
   * `failed`, the webhook handler reverses the booking's refund ledger
   * (audit B-4).
   */
  refundStatus?: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';
  /** Amount of THIS specific refund, in minor units. Distinct from
   * `amountReceivedMinorUnits` which for charge events is the cumulative
   * refunded total. Required to reverse the right amount on a failed refund. */
  refundAmountMinor?: number;
  /**
   * Cumulative refunded total reported by the provider for this charge,
   * in minor units. Set ONLY when the adapter cannot derive a per-event
   * delta (Stripe's `charge.refunded` event with empty `refunds.data`).
   * The webhook helper computes `delta = max(0, cumulative -
   * bookingRef.refundedAmountMinor)` and feeds that into
   * `recordBookingRefund` — this avoids the audit HIGH-3 double-count
   * bug where the helper used to add the cumulative to the running
   * total. When `refundAmountMinor` is also set on the same event,
   * the helper prefers the delta and ignores this field. */
  refundCumulativeMinor?: number;
  data: unknown;
}

// ─── The interface every adapter implements ───────────────────────────

export interface PaymentProviderAdapter {
  readonly name: ProviderName;
  readonly displayName: string;

  // Single connect flow: each merchant pastes their provider credentials
  // into the settings form. The adapter validates them by round-tripping
  // an authenticated request before storing the encrypted blob.
  connectWithCredentials(input: DirectConnectInput): Promise<DirectConnectResult>;

  // Payment lifecycle.
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /**
   * Optional. Force a redirect-style checkout, returning a hosted URL even
   * for providers that normally do inline (Stripe PaymentIntent → Checkout
   * Session). Mobile clients call this so they can open in a WebBrowser.
   * If not implemented, callers should fall back to `createPayment`.
   */
  createHostedCheckout?(input: CreatePaymentInput): Promise<CreatePaymentResult & { flow: 'redirect' }>;
  refund(input: RefundInput): Promise<RefundResult>;
  getPaymentStatus(input: PaymentStatusInput): Promise<PaymentStatusResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent>;
}

export class PaymentProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(code: string, message: string, opts?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.name = 'PaymentProviderError';
    if (opts?.cause) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Audit F-16 (2026-05-06 comprehensive). Adapters embed up to 200
 * characters of provider response body in their thrown error
 * messages — a useful debug signal but a defense-in-depth gap when
 * the response body echoes a cardholder name, last4, or rider email
 * back. The logger's `scrubPiiInString` runs at the structured-log
 * boundary, but provider-error messages also surface in `cause.
 * message` and operator-visible toasts; sanitizing at the source
 * keeps both layers safe.
 *
 * Strips email/phone shapes, then truncates to 200 chars.
 */
const PROVIDER_BODY_PII_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  { regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '[REDACTED-EMAIL]' },
  { regex: /\+\d[\d\s().-]{6,}\d/g, replacement: '[REDACTED-PHONE]' },
  { regex: /\(\d{2,4}\)\s*\d[\d\s.-]{4,}\d/g, replacement: '[REDACTED-PHONE]' },
  // Cardholder name labels — common shapes in N-Genius / Ziina error
  // bodies. Conservative: only triggers when the label is present
  // (won't strip a plain "John Doe" mid-sentence).
  { regex: /(cardholder(?:Name)?\s*[:=]\s*)["']?[A-Za-z][\w\s.'-]{1,80}/gi, replacement: '$1[REDACTED-NAME]' },
  { regex: /(name\s*[:=]\s*)["']?[A-Z][a-z]+\s+[A-Z][a-z]+/g, replacement: '$1[REDACTED-NAME]' },
  // Audit F-74 (2026-05-07 r4): bare 13-19 digit runs (PAN length range,
  // optionally space- or dash-grouped). N-Genius edge cases have been
  // observed to echo a card number in error bodies. The match doesn't
  // Luhn-validate (false positives on plain numeric ids are acceptable
  // because the redaction is a one-way scrub on operator-facing text);
  // Luhn would be defense-in-depth but adding it here only inside a
  // regex-replace path isn't worth the complexity. Run before email
  // patterns so a "card: 4111 1111…" line gets the digits scrubbed
  // even if a label-prefix regex matches first.
  { regex: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED-CARD]' },
];

export function safeProviderPreview(rawBody: string, maxChars = 200): string {
  let scrubbed = rawBody;
  for (const { regex, replacement } of PROVIDER_BODY_PII_PATTERNS) {
    scrubbed = scrubbed.replace(regex, replacement);
  }
  return scrubbed.slice(0, maxChars);
}
