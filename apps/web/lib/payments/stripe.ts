import Stripe from 'stripe';
import { logger } from '@/lib/logger';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type OAuthCallbackInput,
  type OAuthCallbackResult,
  type OAuthInitInput,
  type OAuthInitResult,
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

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new PaymentProviderError(
      'PROVIDER_NOT_CONFIGURED',
      'STRIPE_SECRET_KEY is not set',
    );
  }
  stripeClient = new Stripe(secret, { typescript: true });
  return stripeClient;
}

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', `${name} is not set`);
  }
  return value;
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
  connectMode: 'oauth',
  displayName: 'Stripe',

  async initOAuthConnection(input: OAuthInitInput): Promise<OAuthInitResult> {
    const clientId = assertEnv('STRIPE_CLIENT_ID');
    const redirectUri = new URL('/api/v1/payments/stripe/callback', assertEnv('NEXT_PUBLIC_APP_URL'));

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      state: input.stateToken,
      redirect_uri: redirectUri.toString(),
    });

    // Pre-fill fields on Stripe's onboarding page if we have them. Non-critical.
    params.set('stripe_user[business_type]', 'company');

    return {
      redirectUrl: `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
    };
  },

  async completeOAuthCallback(input: OAuthCallbackInput): Promise<OAuthCallbackResult> {
    const stripe = getStripe();

    let tokenResponse: Stripe.OAuthToken;
    try {
      tokenResponse = await stripe.oauth.token({
        grant_type: 'authorization_code',
        code: input.code,
      });
    } catch (err) {
      throw new PaymentProviderError(
        'OAUTH_EXCHANGE_FAILED',
        err instanceof Error ? err.message : 'Stripe OAuth code exchange failed',
        { cause: err },
      );
    }

    const accountId = tokenResponse.stripe_user_id;
    if (!accountId) {
      throw new PaymentProviderError(
        'OAUTH_NO_ACCOUNT_ID',
        'Stripe did not return a connected account id',
      );
    }

    // Fetch the connected account so we can surface charges_enabled / country /
    // default currency in the settings UI without re-querying later.
    let account: Stripe.Account | null = null;
    try {
      account = await stripe.accounts.retrieve(accountId);
    } catch (err) {
      logger.warn('stripe_account_retrieve_failed', {
        accountId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    return {
      externalAccountId: accountId,
      metadata: {
        livemode: tokenResponse.livemode,
        scope: tokenResponse.scope,
        country: account?.country ?? null,
        defaultCurrency: account?.default_currency ?? null,
        chargesEnabled: account?.charges_enabled ?? null,
        payoutsEnabled: account?.payouts_enabled ?? null,
        businessName: account?.business_profile?.name ?? null,
        email: account?.email ?? null,
      },
      // Standard Connect drives requests via our platform secret + the
      // `stripeAccount` header, so there's no per-account credential to store.
      credentials: null,
    };
  },

  /**
   * Creates a Stripe Checkout Session scoped to the connected account and
   * returns its hosted URL. Used by clients (mobile) that can't render the
   * PaymentElement inline.
   */
  async createHostedCheckout(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult & { flow: 'redirect' }> {
    const stripe = getStripe();

    if (!input.account.externalAccountId) {
      throw new PaymentProviderError(
        'ACCOUNT_NOT_CONNECTED',
        'Stripe account id is missing — club has not completed Connect onboarding',
      );
    }

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
            ...(input.applicationFeeMinorUnits
              ? { application_fee_amount: input.applicationFeeMinorUnits }
              : {}),
          },
        },
        {
          stripeAccount: input.account.externalAccountId,
          // Audit H-1: use the SAME idempotency key as the inline-PI path
          // so a rider who started with `mode=default` (PI-A) and retried
          // with `mode=hosted` doesn't end up with two distinct PaymentIntents.
          // Stripe returns the existing PI (or its enclosing Checkout
          // Session) when the same key collides with the prior request.
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
        // For Connect Standard we use the underlying PaymentIntent id as our
        // provider_payment_id because webhooks arrive with that id, not the
        // session id. Falls back to session id if the intent isn't yet set.
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
        err instanceof Error ? err.message : 'Stripe Checkout Session creation failed',
        { cause: err },
      );
    }
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const stripe = getStripe();

    if (!input.account.externalAccountId) {
      throw new PaymentProviderError(
        'ACCOUNT_NOT_CONNECTED',
        'Stripe account id is missing — club has not completed Connect onboarding',
      );
    }

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
          application_fee_amount: input.applicationFeeMinorUnits,
        },
        {
          stripeAccount: input.account.externalAccountId,
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
        status: mapIntentStatus(intent.status),
      };
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError(
        'CREATE_PAYMENT_FAILED',
        err instanceof Error ? err.message : 'Stripe PaymentIntent creation failed',
        { cause: err, retryable: err instanceof Stripe.errors.StripeConnectionError },
      );
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripe = getStripe();

    if (!input.account.externalAccountId) {
      throw new PaymentProviderError('ACCOUNT_NOT_CONNECTED', 'Stripe account id is missing');
    }

    try {
      // Standard Connect uses **direct charges** (created with the
      // `stripeAccount` header, charge originates on the connected
      // account, no platform-level transfer). `reverse_transfer` is only
      // meaningful for **destination charges** (`transfer_data[destination]`),
      // which we don't use. Stripe rejects/no-ops the flag for direct
      // charges. `refund_application_fee: true` proportionally reverses
      // the platform fee that was charged on the original PI — that's
      // the correct mechanism here.
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amountMinorUnits,
          reason: input.reason === 'requested_by_customer' ? 'requested_by_customer' : undefined,
          metadata: input.reason ? { reason: input.reason } : undefined,
          refund_application_fee: true,
        },
        {
          stripeAccount: input.account.externalAccountId,
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
        err instanceof Error ? err.message : 'Stripe refund failed',
        { cause: err },
      );
    }
  },

  async getPaymentStatus(input: PaymentStatusInput): Promise<PaymentStatusResult> {
    const stripe = getStripe();

    if (!input.account.externalAccountId) {
      throw new PaymentProviderError('ACCOUNT_NOT_CONNECTED', 'Stripe account id is missing');
    }

    try {
      const intent = await stripe.paymentIntents.retrieve(input.providerPaymentId, {
        stripeAccount: input.account.externalAccountId,
      });

      return {
        status: mapIntentStatus(intent.status),
        amountReceivedMinorUnits: intent.amount_received,
      };
    } catch (err) {
      throw new PaymentProviderError(
        'STATUS_LOOKUP_FAILED',
        err instanceof Error ? err.message : 'Stripe PaymentIntent retrieval failed',
        { cause: err },
      );
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    const stripe = getStripe();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        input.body,
        input.signatureHeader,
        input.webhookSecret,
      );
    } catch (err) {
      throw new PaymentProviderError(
        'INVALID_SIGNATURE',
        err instanceof Error ? err.message : 'Stripe webhook signature verification failed',
        { cause: err },
      );
    }

    // Discriminate on `event.type` so the SDK's union narrows naturally —
    // audit AI-26. Replaces the previous single-cast pattern that lost
    // type safety on every field access.
    let providerPaymentId: string | undefined;
    let status: PaymentIntentStatus | undefined;
    let amountReceivedMinorUnits: number | undefined;
    let bookingId: string | undefined;
    let refundStatus: WebhookEvent['refundStatus'];
    let refundAmountMinor: number | undefined;
    let currency: string | undefined;

    // The `payment_intent` field on Charge / Refund objects is either
    // expanded (full PaymentIntent) or a bare string id. Normalise both
    // shapes to the id string for the webhook handler downstream.
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
        // Charge-level refund event (Stripe fires this in addition to per-
        // refund `charge.refund.updated`). Surface the most recent refund's
        // delta so the webhook helper can call `recordBookingRefund`. For
        // partial refunds the rolling `amount_refunded` is the cumulative
        // total — extract just the latest refund's `amount` from the
        // embedded refunds list.
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
          // No embedded refund — fall back to amount_refunded as the delta
          // (correct for full refund; for partial refund where Stripe hasn't
          // expanded refunds it's the cumulative total which is also the
          // delta if this is the first refund event).
          refundStatus = 'succeeded';
          refundAmountMinor = charge.amount_refunded;
        }
        break;
      }
      case 'charge.succeeded':
      case 'charge.failed': {
        const charge = event.data.object;
        providerPaymentId = piPaymentIntentId(charge.payment_intent);
        // Charge.amount is the captured amount (in minor units). The
        // PaymentIntent's `amount_received` is the canonical source for
        // payment-level amounts; for charge events the Charge's `amount`
        // field is the right-shaped equivalent.
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
        // The Refund carries the parent PaymentIntent + the refund's own
        // status/amount so the webhook handler can reverse the booking
        // ledger when a `pending → failed` transition lands (audit B-4).
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
        // route can dedup/log it without breaking. No fields populated.
        break;
    }

    return {
      eventId: event.id,
      eventType: event.type,
      providerPaymentId,
      // On a Connect platform webhook, `event.account` is the connected
      // account id that the event pertains to.
      providerAccountId: event.account ?? undefined,
      bookingId,
      status,
      amountReceivedMinorUnits,
      currency,
      refundStatus,
      refundAmountMinor,
      data: event,
    };
  },
};
