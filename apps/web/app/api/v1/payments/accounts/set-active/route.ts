import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { setActiveProvider } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const setActiveSchema = z.object({
  provider: z.enum(['stripe', 'n_genius', 'ziina']),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const { provider } = validateInput(setActiveSchema, body);

      const result = await setActiveProvider(ctx.clubId, provider);
      if (!result) {
        return errorResponse(
          'NOT_CONNECTED',
          `${provider} is not connected — finish onboarding before marking it active`,
          422,
        );
      }

      logger.info('payment_active_provider_changed', {
        clubId: ctx.clubId,
        provider,
        actorMemberId: ctx.memberId,
      });

      void ctx.audit({
        action: 'payment_account.set_active',
        resourceType: 'payment_account',
        resourceId: result.id,
      });

      return successResponse(result);
    },
    { requiredPermission: 'settings:update' },
  );
}
