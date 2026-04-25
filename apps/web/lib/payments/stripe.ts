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
          idempotencyKey: `checkout_${input.idempotencyKey}`,
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
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amountMinorUnits,
          reason: input.reason === 'requested_by_customer' ? 'requested_by_customer' : undefined,
          metadata: input.reason ? { reason: input.reason } : undefined,
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

    // Extract payment-intent-specific fields when this is a PI event.
    let providerPaymentId: string | undefined;
    let status: PaymentIntentStatus | undefined;
    let amountReceivedMinorUnits: number | undefined;
    let bookingId: string | undefined;

    if (event.data.object && typeof event.data.object === 'object') {
      const obj = event.data.object as {
        id?: string;
        object?: string;
        status?: string;
        amount_received?: number;
        payment_intent?: string | { id?: string } | null;
        amount_refunded?: number;
        metadata?: Record<string, string | undefined>;
      };
      if (obj.object === 'payment_intent' && obj.id) {
        providerPaymentId = obj.id;
        if (obj.status) {
          status = mapIntentStatus(obj.status as Stripe.PaymentIntent.Status);
        }
        amountReceivedMinorUnits = obj.amount_received;
      } else if (obj.object === 'charge') {
        // Charge-level events (charge.refunded, charge.refund.updated) carry
        // the PaymentIntent id on the Charge, not on `obj.id`. That's how we
        // find the booking downstream.
        providerPaymentId =
          typeof obj.payment_intent === 'string'
            ? obj.payment_intent
            : obj.payment_intent?.id;
        amountReceivedMinorUnits = obj.amount_refunded;
      }
      // Our own `bookingId` rides on the PI's metadata — stamped at create
      // time by the bookings/[id]/payment route. Lets the webhook resolve
      // the booking even when the `provider_payment_id` column hasn't been
      // written yet (fast-succeed payments racing with the route).
      const md = obj.metadata;
      if (md && typeof md.bookingId === 'string') {
        bookingId = md.bookingId;
      }
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
      data: event,
    };
  },
};
