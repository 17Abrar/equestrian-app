import Stripe from 'stripe';
import { z } from 'zod';
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
 * Stripe adapter — direct integration. Each club pastes their own Stripe
 * API keys into the settings form; we encrypt them into
 * `club_payment_accounts.encrypted_credentials` and use them to drive
 * payments under the club's merchant account directly. Cavaliq is NOT a
 * Stripe Connect platform — there is no platform `STRIPE_CLIENT_ID`, no
 * OAuth flow, no `application_fee_amount`, no `stripeAccount` header on
 * SDK calls. Each charge lands in the club's Stripe balance with no
 * platform cut, and the 0.9% per-booking fee that the Connect path used
 * to capture is retired (subscription tiers carry the revenue).
 *
 * Webhook delivery is per-club. The merchant configures
 * `https://cavaliq.com/api/webhooks/stripe/<clubId>` in their own Stripe
 * dashboard; the URL embeds the clubId so the receiver can look up the
 * right per-club signing secret.
 */

const stripeCredentialsSchema = z.object({
  /** Stripe secret key — `sk_live_…` or `sk_test_…`. Used server-side. */
  secretKey: z
    .string()
    .min(1, 'secretKey is required')
    .refine((v) => v.startsWith('sk_'), 'secretKey must start with "sk_"'),
  /**
   * Stripe publishable key — `pk_live_…` or `pk_test_…`. Returned to the
   * client at payment-init time so the pay dialog can mount Elements
   * with the correct merchant account. Storing it alongside the secret
   * keeps the live/test mode coupled — a stable that pasted a live
   * `sk_live_…` cannot accidentally be charged through a `pk_test_…`.
   */
  publishableKey: z
    .string()
    .min(1, 'publishableKey is required')
    .refine((v) => v.startsWith('pk_'), 'publishableKey must start with "pk_"'),
  /**
   * Webhook signing secret (`whsec_…`) from the merchant's webhook
   * endpoint config in Stripe. Optional at connect time so a stable can
   * skip Stripe webhooks entirely (status will only update via the
   * inline-confirm response), but recommended — without it, refunds
   * issued from the Stripe dashboard won't reflect in the booking
   * ledger.
   */
  webhookSigningSecret: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('whsec_'), 'webhookSigningSecret must start with "whsec_"')
    .optional(),
});

type StripeCredentials = z.infer<typeof stripeCredentialsSchema>;

function parseCredentials(raw: unknown): StripeCredentials {
  const result = stripeCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new PaymentProviderError(
      'INVALID_CREDENTIALS',
      `Stripe credentials are invalid: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

function getClient(creds: StripeCredentials): Stripe {
  // No module-level cache — each club has a different secret key. The
  // Stripe SDK is cheap to instantiate; the underlying connection pool
  // is shared via Node's HTTP agent.
  //
  // Audit LOW-13 (2026-05-05): pin `apiVersion` so a transitive
  // SDK upgrade can't quietly bump the API surface our adapter is
  // built against (e.g. a Stripe webhook event payload reshape between
  // versions, or a property rename on PaymentIntent/Charge that we
  // currently access without a guard). Matches `stripe@18.5.0`'s
  // declared `LatestApiVersion`. Bumping is a deliberate change —
  // version bumps to this constant should ride with adapter testing.
  return new Stripe(creds.secretKey, {
    apiVersion: '2025-08-27.basil',
    typescript: true,
  });
}

/**
 * Audit LOW-2 (2026-05-05): defensively scrub the `_secret_xxx` half of a
 * PaymentIntent client_secret before letting a Stripe error message
 * propagate. Stripe error messages don't currently echo the secret, but a
 * future SDK change or a rare error path that includes the request body
 * could surface it. The error message lands in `cause.message` and on
 * `PaymentProviderError.message`, both of which our callers log
 * (`booking_payment_provider_error` warns with `err.message`). The
 * `pi_xxx_secret_yyy` shape is the documented Stripe convention.
 */
function scrubStripeErrorMessage(raw: string): string {
  return raw.replace(/(_secret_)[A-Za-z0-9]+/g, '$1[REDACTED]');
}

function mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentIntentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'canceled':
      return 'cancelled';
    case 'requires_action':
    case 'requires_confirmation':
    case 'requires_payment_method':
      return 'requires_action';
    case 'processing':
      return 'pending';
    case 'requires_capture':
      return 'pending';
    default:
      return 'pending';
  }
}

function mapRefundStatus(
  status: Stripe.Refund['status'],
): 'pending' | 'succeeded' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'pending':
    case 'requires_action':
    default:
      return 'pending';
  }
}

export const stripeAdapter: PaymentProviderAdapter = {
  name: 'stripe',
  displayName: 'Stripe',

  async connectWithCredentials(input: DirectConnectInput): Promise<DirectConnectResult> {
    const creds = parseCredentials({
      secretKey: input.credentials.secretKey,
      publishableKey: input.credentials.publishableKey,
      webhookSigningSecret: input.credentials.webhookSigningSecret,
    });

    // Round-trip the secret against `accounts.retrieve()` so we reject bad
    // keys at connect time instead of at first payment. No argument =
    // retrieve the account THIS API key belongs to.
    let account: Stripe.Account;
    try {
      account = await getClient(creds).accounts.retrieve();
    } catch (err) {
      throw new PaymentProviderError(
        'AUTH_FAILED',
        err instanceof Error
          ? scrubStripeErrorMessage(err.message)
          : 'Stripe key validation failed',
        { cause: err },
      );
    }

    // Live/test mode parity check. A stable that pastes `sk_test_…` with
    // `pk_live_…` would otherwise look connected and then silently fail
    // every payment with a mode-mismatch error from Elements. Stripe key
    // prefixes encode the mode reliably.
    const secretIsLive = creds.secretKey.startsWith('sk_live_');
    const publishableIsLive = creds.publishableKey.startsWith('pk_live_');
    if (secretIsLive !== publishableIsLive) {
      throw new PaymentProviderError(
        'KEY_MODE_MISMATCH',
        'Secret and publishable keys must be the same mode (both live or both test).',
      );
    }

    return {
      externalAccountId: account.id,
      metadata: {
        livemode: secretIsLive,
        country: account.country ?? null,
        defaultCurrency: account.default_currency ?? null,
        chargesEnabled: account.charges_enabled ?? null,
        payoutsEnabled: account.payouts_enabled ?? null,
        businessName: account.business_profile?.name ?? null,
        email: account.email ?? null,
        hasWebhookSecret: !!creds.webhookSigningSecret,
      },
      credentials: { ...creds },
    };
  },

  /**
   * Creates a Stripe Checkout Session. Used by clients (mobile) that
   * can't render the PaymentElement inline.
   */
  async createHostedCheckout(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult & { flow: 'redirect' }> {
    const creds = parseCredentials(input.account.credentials);
    const stripe = getClient(creds);

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          success_url: input.returnUrl,
          cancel_url: input.returnUrl,
          client_reference_id: input.bookingId,
          line_items: [
            {
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amountMinorUnits,
                product_data: {
                  name: input.description ?? `Booking ${input.bookingId}`,
                },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: {
              bookingId: input.bookingId,
              riderId: input.riderId,
              clubId: input.clubId,
              ...input.metadata,
            },
          },
        },
        {
          // Audit H-1: same idempotency key as the inline-PI path so a
          // rider who started with `mode=default` (PI-A) and retried
          // with `mode=hosted` doesn't end up with two distinct
          // PaymentIntents.
          idempotencyKey: input.idempotencyKey,
        },
      );

      if (!session.url) {
        throw new PaymentProviderError(
          'NO_CHECKOUT_URL',
          'Stripe returned a Checkout Session with no url',
        );
      }

      return {
        flow: 'redirect',
        // Use the underlying PaymentIntent id as our provider_payment_id
        // because webhooks arrive with that id, not the session id.
        // Falls back to session id if the intent isn't yet set.
        providerPaymentId:
          (typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id) ?? session.id,
        paymentUrl: session.url,
        status: 'pending',
      };
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        'CREATE_CHECKOUT_FAILED',
        err instanceof Error
          ? scrubStripeErrorMessage(err.message)
          : 'Stripe Checkout Session creation failed',
        { cause: err },
      );
    }
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const creds = parseCredentials(input.account.credentials);
    const stripe = getClient(creds);

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amountMinorUnits,
          currency: input.currency.toLowerCase(),
          description: input.description,
          metadata: {
            bookingId: input.bookingId,
            riderId: input.riderId,
            clubId: input.clubId,
            ...input.metadata,
          },
          // `automatic_payment_methods` lets Stripe choose the right surfaces
          // per region (card, Apple/Google Pay, Link, etc.).
          automatic_payment_methods: { enabled: true },
        },
        {
          idempotencyKey: input.idempotencyKey,
        },
      );

      if (!intent.client_secret) {
        throw new PaymentProviderError(
          'NO_CLIENT_SECRET',
          'Stripe returned a PaymentIntent with no client_secret',
        );
      }

      return {
        flow: 'inline',
        providerPaymentId: intent.id,
        clientSecret: intent.client_secret,
        publishableKey: creds.publishableKey,
        status: mapIntentStatus(intent.status),
      };
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        'CREATE_PAYMENT_FAILED',
        err instanceof Error
          ? scrubStripeErrorMessage(err.message)
          : 'Stripe PaymentIntent creation failed',
        { cause: err, retryable: err instanceof Stripe.errors.StripeConnectionError },
      );
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const creds = parseCredentials(input.account.credentials);
    const stripe = getClient(creds);

    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amountMinorUnits,
          reason: input.reason === 'requested_by_customer' ? 'requested_by_customer' : undefined,
          metadata: input.reason ? { reason: input.reason } : undefined,
        },
        {
          idempotencyKey: input.idempotencyKey,
        },
      );

      return {
        providerRefundId: refund.id,
        status: mapRefundStatus(refund.status),
      };
    } catch (err) {
      throw new PaymentProviderError(
        'REFUND_FAILED',
        err instanceof Error ? scrubStripeErrorMessage(err.message) : 'Stripe refund failed',
        { cause: err },
      );
    }
  },

  async getPaymentStatus(input: PaymentStatusInput): Promise<PaymentStatusResult> {
    const creds = parseCredentials(input.account.credentials);
    const stripe = getClient(creds);

    try {
      const intent = await stripe.paymentIntents.retrieve(input.providerPaymentId);

      return {
        status: mapIntentStatus(intent.status),
        amountReceivedMinorUnits: intent.amount_received,
      };
    } catch (err) {
      throw new PaymentProviderError(
        'STATUS_LOOKUP_FAILED',
        err instanceof Error
          ? scrubStripeErrorMessage(err.message)
          : 'Stripe PaymentIntent retrieval failed',
        { cause: err },
      );
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    // The route hands us the per-club webhook signing secret — there is no
    // platform-level webhook receiver any more. `Stripe.webhooks.constructEvent`
    // is a static crypto helper (signature verify + timestamp window) that
    // does NOT require an authenticated client — using the static surface
    // avoids the dummy-key instance the prior implementation needed and
    // saves a per-webhook HTTP-agent allocation. Audit F-6 (2026-05-05).
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(
        input.body,
        input.signatureHeader,
        input.webhookSecret,
      );
    } catch (err) {
      throw new PaymentProviderError(
        'INVALID_SIGNATURE',
        err instanceof Error
          ? scrubStripeErrorMessage(err.message)
          : 'Stripe webhook signature verification failed',
        { cause: err },
      );
    }

    // Discriminate on `event.type` so the SDK's union narrows naturally —
    // audit AI-26.
    let providerPaymentId: string | undefined;
    let status: PaymentIntentStatus | undefined;
    let amountReceivedMinorUnits: number | undefined;
    let bookingId: string | undefined;
    let refundStatus: WebhookEvent['refundStatus'];
    let refundAmountMinor: number | undefined;
    let refundCumulativeMinor: number | undefined;
    let currency: string | undefined;

    function piPaymentIntentId(
      pi: string | Stripe.PaymentIntent | null | undefined,
    ): string | undefined {
      if (typeof pi === 'string') return pi;
      if (pi && typeof pi === 'object' && typeof pi.id === 'string') {
        return pi.id;
      }
      return undefined;
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
      case 'payment_intent.requires_action':
      case 'payment_intent.created': {
        const pi = event.data.object;
        providerPaymentId = pi.id;
        status = mapIntentStatus(pi.status);
        amountReceivedMinorUnits = pi.amount_received;
        currency = pi.currency?.toUpperCase();
        const md = pi.metadata;
        if (md && typeof md.bookingId === 'string') {
          bookingId = md.bookingId;
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        providerPaymentId = piPaymentIntentId(charge.payment_intent);
        currency = charge.currency?.toUpperCase();
        const md = charge.metadata;
        if (md && typeof md.bookingId === 'string') {
          bookingId = md.bookingId;
        }
        const refundsList = charge.refunds?.data ?? [];
        if (refundsList.length > 0) {
          const sorted = [...refundsList].sort(
            (a, b) => (b.created ?? 0) - (a.created ?? 0),
          );
          const latest = sorted[0];
          if (latest) {
            refundStatus = latest.status as WebhookEvent['refundStatus'];
            refundAmountMinor = latest.amount;
          }
        } else {
          // Audit HIGH-3 (2026-05-05): empty `refunds.data` means
          // Stripe didn't expand the refund list on this event. The
          // only signal we have is `charge.amount_refunded`, which is
          // CUMULATIVE (sum of every refund against this charge so
          // far). Surface it as `refundCumulativeMinor` rather than
          // `refundAmountMinor` — the webhook helper computes a true
          // delta by subtracting the booking's running ledger total.
          // The previous version treated cumulative as delta and
          // double-counted on every refund after the first.
          refundStatus = 'succeeded';
          refundCumulativeMinor = charge.amount_refunded;
        }
        break;
      }
      case 'charge.succeeded':
      case 'charge.failed': {
        const charge = event.data.object;
        providerPaymentId = piPaymentIntentId(charge.payment_intent);
        amountReceivedMinorUnits = charge.amount;
        currency = charge.currency?.toUpperCase();
        const md = charge.metadata;
        if (md && typeof md.bookingId === 'string') {
          bookingId = md.bookingId;
        }
        break;
      }
      case 'charge.refund.updated': {
        const refund = event.data.object;
        providerPaymentId = piPaymentIntentId(refund.payment_intent);
        refundStatus = refund.status as WebhookEvent['refundStatus'];
        refundAmountMinor = refund.amount;
        currency = refund.currency?.toUpperCase();
        const md = refund.metadata;
        if (md && typeof md.bookingId === 'string') {
          bookingId = md.bookingId;
        }
        break;
      }
      default:
        // Unhandled event type — return the envelope so the webhook
        // route can dedup/log it without breaking.
        break;
    }

    return {
      eventId: event.id,
      eventType: event.type,
      providerPaymentId,
      // `event.account` is set on Connect platform webhooks. With direct
      // keys we don't get that field — the route resolves clubId from
      // the URL path instead.
      providerAccountId: event.account ?? undefined,
      bookingId,
      status,
      amountReceivedMinorUnits,
      currency,
      refundStatus,
      refundAmountMinor,
      refundCumulativeMinor,
      data: event,
    };
  },
};
