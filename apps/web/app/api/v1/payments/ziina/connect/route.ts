import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { upsertPaymentAccount } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { ziinaAdapter } from '@/lib/payments/ziina';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const connectSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  webhookSigningSecret: z.string().optional(),
  makeActive: z.boolean().default(true),
});

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

        const account = await upsertPaymentAccount(ctx.clubId, {
          provider: 'ziina',
          status: 'connected',
          externalAccountId: result.externalAccountId,
          credentials: result.credentials,
          metadata: result.metadata,
          makeActive: data.makeActive,
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
