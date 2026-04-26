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
  | 'refunded';

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
  /** Platform cut in minor units — only honored by providers that support split payments. */
  applicationFeeMinorUnits?: number;
}

export type CreatePaymentResult =
  | {
      flow: 'inline';
      providerPaymentId: string;
      /** Returned by Stripe to mount Elements client-side. */
      clientSecret: string;
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
  amountReceivedMinorUnits: number;
}

// ─── Connection (OAuth) — Stripe ──────────────────────────────────────

export interface OAuthInitInput {
  clubId: string;
  /** App-side page the user should land on after completing Stripe onboarding. */
  returnUrl: string;
  /** Opaque signed state used to defend against CSRF on the OAuth callback. */
  stateToken: string;
}

export interface OAuthInitResult {
  redirectUrl: string;
}

export interface OAuthCallbackInput {
  code: string;
}

export interface OAuthCallbackResult {
  externalAccountId: string;
  metadata: Record<string, unknown>;
  /** Providers that issue a refresh/access token store it here (encrypted downstream). */
  credentials: DecryptedCredentials | null;
}

// ─── Connection (direct API key) — N-Genius, Ziina ────────────────────

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
  data: unknown;
}

// ─── The interface every adapter implements ───────────────────────────

export interface PaymentProviderAdapter {
  readonly name: ProviderName;
  readonly connectMode: 'oauth' | 'api_key';
  readonly displayName: string;

  // Connect flow — providers implement the variant matching `connectMode`.
  initOAuthConnection?(input: OAuthInitInput): Promise<OAuthInitResult>;
  completeOAuthCallback?(input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
  connectWithCredentials?(input: DirectConnectInput): Promise<DirectConnectResult>;

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
