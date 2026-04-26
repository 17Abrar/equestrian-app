import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { upsertPaymentAccount } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { nGeniusAdapter } from '@/lib/payments/n-genius';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const connectSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  outletReference: z.string().min(1, 'Outlet reference is required'),
  /** Some N-Genius tenant configurations require a realmName for the identity exchange. */
  realmName: z.string().optional(),
  /** Custom header name the merchant configured in the N-Genius portal (e.g. "X-Webhook-Token"). */
  webhookHeaderName: z.string().optional(),
  /** Secret value N-Genius will echo in the configured header on each webhook delivery. */
  webhookHeaderValue: z.string().optional(),
  makeActive: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(connectSchema, body);

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
            ...(data.realmName ? { realmName: data.realmName } : {}),
            ...(data.webhookHeaderName
              ? { webhookHeaderName: data.webhookHeaderName }
              : {}),
            ...(data.webhookHeaderValue
              ? { webhookHeaderValue: data.webhookHeaderValue }
              : {}),
          },
        });

        const account = await upsertPaymentAccount(ctx.clubId, {
          provider: 'n_genius',
          status: 'connected',
          externalAccountId: result.externalAccountId,
          credentials: result.credentials,
          metadata: result.metadata,
          makeActive: data.makeActive,
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
