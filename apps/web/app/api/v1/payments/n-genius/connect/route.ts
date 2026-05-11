import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { upsertPaymentAccount, WebhookSecretReusedError } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { nGeniusAdapter } from '@/lib/payments/n-genius';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

// Header names we won't accept as the webhook authenticator — they get
// overwritten by N-Genius (or proxies) on retry, leaving the second
// delivery unauthenticated. See audit B-5. Lowercased on lookup so the
// merchant can't bypass with a different case.
const WEBHOOK_HEADER_NAME_DENYLIST = new Set([
  'authorization',
  'cookie',
  'host',
  'content-type',
  'content-length',
  'user-agent',
  'accept',
  'accept-encoding',
]);

// 32 hex chars / 24 base64 chars / 32 random URL-safe chars give ~128 bits
// of entropy. We don't measure entropy precisely — the cap forces the
// merchant to think about it (UUIDv4 = 36 chars, hex SHA-256 = 64 chars).
// See audit B-5: a 1- or 2-char value would let a third party trivially
// forge webhooks once they observe the merchant's outlet id (visible on
// payment receipts).
const MIN_WEBHOOK_HEADER_VALUE_LENGTH = 32;

const connectSchema = z
  .object({
    apiKey: z.string().min(1, 'API key is required'),
    outletReference: z.string().min(1, 'Outlet reference is required'),
    /** Some N-Genius tenant configurations require a realmName for the identity exchange. */
    realmName: z.string().optional(),
    /** Custom header name the merchant configured in the N-Genius portal (e.g. "X-Webhook-Token"). */
    webhookHeaderName: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (name) => !WEBHOOK_HEADER_NAME_DENYLIST.has(name.toLowerCase()),
        'Header name conflicts with a standard HTTP header — pick a custom name like X-Webhook-Token',
      )
      .optional(),
    /** Secret value N-Genius will echo in the configured header on each webhook delivery. */
    webhookHeaderValue: z
      .string()
      .min(
        MIN_WEBHOOK_HEADER_VALUE_LENGTH,
        `Webhook secret must be at least ${MIN_WEBHOOK_HEADER_VALUE_LENGTH} characters of high-entropy random data — generate via \`openssl rand -hex 32\``,
      )
      .max(512)
      .optional(),
    /**
     * Audit LOW (2026-05-06): the outlet's settlement currency.
     * Defaults to AED for the GCC-dominant tenant case but is captured
     * here so SAR / KWD / etc. operators can connect without every
     * payment 422-blocking on the currency-parity check downstream.
     * 3-letter ISO 4217. The adapter's credential schema enforces the
     * same constraint at the encryption boundary.
     */
    defaultCurrency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code (e.g. AED, SAR, KWD)')
      .default('AED'),
    makeActive: z.boolean().default(true),
  })
  // Audit F-2 (2026-05-06): `.strict()` BEFORE `.refine()` — `.refine`
  // returns ZodEffects which doesn't expose `.strict()`. Without this,
  // a caller can sneak `{ ..., role: 'club_admin' }` through.
  .strict()
  // Both header fields are paired — either set both or neither.
  .refine(
    (data) =>
      (data.webhookHeaderName && data.webhookHeaderValue) ||
      (!data.webhookHeaderName && !data.webhookHeaderValue),
    'Webhook header name and value must be set together',
  );

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, connectSchema);

      if (!nGeniusAdapter.connectWithCredentials) {
        return errorResponse(
          'NOT_SUPPORTED',
          'N-Genius adapter does not support credential connect',
          500,
        );
      }

      try {
        const result = await nGeniusAdapter.connectWithCredentials({
          clubId: ctx.clubId,
          credentials: {
            apiKey: data.apiKey,
            outletReference: data.outletReference,
            defaultCurrency: data.defaultCurrency,
            ...(data.realmName ? { realmName: data.realmName } : {}),
            ...(data.webhookHeaderName ? { webhookHeaderName: data.webhookHeaderName } : {}),
            ...(data.webhookHeaderValue ? { webhookHeaderValue: data.webhookHeaderValue } : {}),
          },
        });

        // Audit F-33 (2026-05-08 r6): hash the N-Genius webhook header
        // value (the shared-secret echoed by N-Genius on every delivery)
        // so upsert can reject any other club already using it.
        const webhookSecretHash = data.webhookHeaderValue
          ? createHash('sha256').update(data.webhookHeaderValue).digest('hex')
          : null;

        const account = await upsertPaymentAccount(ctx.clubId, {
          provider: 'n_genius',
          status: 'connected',
          externalAccountId: result.externalAccountId,
          credentials: result.credentials,
          metadata: result.metadata,
          makeActive: data.makeActive,
          webhookSecretHash,
        });

        logger.info('n_genius_connected', {
          clubId: ctx.clubId,
          outletReference: result.externalAccountId,
          actorMemberId: ctx.memberId,
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
          if (err.code === 'AUTH_FAILED' || err.code === 'INVALID_CREDENTIALS') {
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
