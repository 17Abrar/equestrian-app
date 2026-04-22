import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { disconnectPaymentAccount } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const providerSchema = z.enum(['stripe', 'n_genius', 'ziina']);

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { provider: providerParam } = await params;
      const provider = validateInput(providerSchema, providerParam);

      const result = await disconnectPaymentAccount(ctx.clubId, provider);
      if (!result) {
        return errorResponse('NOT_FOUND', 'No payment account found for that provider', 404);
      }

      logger.info('payment_account_disconnected', {
        clubId: ctx.clubId,
        provider,
        actorMemberId: ctx.memberId,
      });

      void ctx.audit({
        action: 'payment_account.disconnect',
        resourceType: 'payment_account',
        resourceId: result.id,
      });

      return successResponse(result);
    },
    { requiredPermission: 'settings:update' },
  );
}
