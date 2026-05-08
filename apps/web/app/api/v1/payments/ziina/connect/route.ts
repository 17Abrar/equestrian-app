import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { upsertPaymentAccount, WebhookSecretReusedError } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { ziinaAdapter } from '@/lib/payments/ziina';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const connectSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  // Audit L-2: minimum 32 chars matches the N-Genius header secret floor.
  // A merchant who pastes a single-char value into the Ziina form would
  // otherwise let an attacker forge webhooks trivially.
  webhookSigningSecret: z
    .string()
    .min(32, 'Webhook signing secret must be at least 32 characters')
    .optional(),
  makeActive: z.boolean().default(true),
}).strict();

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(connectSchema, body);

      try {
        const result = await ziinaAdapter.connectWithCredentials!({
          clubId: ctx.clubId,
          credentials: {
            apiKey: data.apiKey,
            ...(data.webhookSigningSecret
              ? { webhookSigningSecret: data.webhookSigningSecret }
              : {}),
          },
        });

        // Audit F-33 (2026-05-08 r6): hash the webhook secret so
        // upsert can reject any other club already using the same one.
        const webhookSecretHash = data.webhookSigningSecret
          ? createHash('sha256').update(data.webhookSigningSecret).digest('hex')
          : null;

        const account = await upsertPaymentAccount(ctx.clubId, {
          provider: 'ziina',
          status: 'connected',
          externalAccountId: result.externalAccountId,
          credentials: result.credentials,
          metadata: result.metadata,
          makeActive: data.makeActive,
          webhookSecretHash,
        });

        logger.info('ziina_connected', {
          clubId: ctx.clubId,
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
