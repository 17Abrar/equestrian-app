import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { upsertPaymentAccount, WebhookSecretReusedError } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { stripeAdapter } from '@/lib/payments/stripe';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * Connects a club's Stripe account by accepting the merchant's API keys
 * directly. We are NOT a Stripe Connect platform — there is no OAuth
 * flow, no `STRIPE_CLIENT_ID`, no platform secret. Each stable runs
 * Stripe under their own merchant account; we encrypt and store their
 * keys in `club_payment_accounts.encrypted_credentials` and use them
 * to drive payments on the club's behalf.
 *
 * Mirrors the `/payments/n-genius/connect` and `/payments/ziina/connect`
 * shape — the form is in `components/payments/payments-panel.tsx`.
 */

const connectSchema = z
  .object({
    /** Stripe secret key — `sk_live_…` or `sk_test_…`. */
    secretKey: z
      .string()
      .min(1, 'Secret key is required')
      .max(255)
      .refine((v) => v.startsWith('sk_'), 'Secret key must start with "sk_"'),
    /** Stripe publishable key — `pk_live_…` or `pk_test_…`. */
    publishableKey: z
      .string()
      .min(1, 'Publishable key is required')
      .max(255)
      .refine((v) => v.startsWith('pk_'), 'Publishable key must start with "pk_"'),
    /** Optional. From the merchant's webhook endpoint config in Stripe. */
    webhookSigningSecret: z
      .string()
      .min(1)
      .max(255)
      .refine((v) => v.startsWith('whsec_'), 'Webhook secret must start with "whsec_"')
      .optional(),
    makeActive: z.boolean().default(true),
  })
  .strict();

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, connectSchema);

      try {
        const result = await stripeAdapter.connectWithCredentials({
          clubId: ctx.clubId,
          credentials: {
            secretKey: data.secretKey,
            publishableKey: data.publishableKey,
            ...(data.webhookSigningSecret
              ? { webhookSigningSecret: data.webhookSigningSecret }
              : {}),
          },
        });

        // Audit F-33 (2026-05-08 r6): SHA-256 the webhook signing
        // secret so the upsert can enforce "no two clubs use the same
        // `whsec_…`". Hashing the cleartext (not what the adapter
        // returned) keeps the digest stable across the encrypt/decrypt
        // round-trip the credentials blob takes.
        const webhookSecretHash = data.webhookSigningSecret
          ? createHash('sha256').update(data.webhookSigningSecret).digest('hex')
          : null;

        const account = await upsertPaymentAccount(ctx.clubId, {
          provider: 'stripe',
          status: 'connected',
          externalAccountId: result.externalAccountId,
          credentials: result.credentials,
          metadata: result.metadata,
          makeActive: data.makeActive,
          webhookSecretHash,
        });

        logger.info('stripe_connected', {
          clubId: ctx.clubId,
          stripeAccountId: result.externalAccountId,
          actorMemberId: ctx.memberId,
          chargesEnabled: result.metadata.chargesEnabled ?? null,
        });

        void ctx.audit({
          action: 'payment_account.connect',
          resourceType: 'payment_account',
          resourceId: account.id,
        });

        return successResponse(account, 201);
      } catch (err) {
        if (err instanceof WebhookSecretReusedError) {
          return errorResponse('WEBHOOK_SECRET_REUSED', err.message, 409);
        }
        if (err instanceof PaymentProviderError) {
          if (
            err.code === 'AUTH_FAILED' ||
            err.code === 'INVALID_CREDENTIALS' ||
            err.code === 'KEY_MODE_MISMATCH'
          ) {
            return errorResponse(err.code, err.message, 422);
          }
          return errorResponse(err.code, err.message, 502);
        }
        throw err;
      }
    },
    { requiredPermission: 'settings:update' },
  );
}
