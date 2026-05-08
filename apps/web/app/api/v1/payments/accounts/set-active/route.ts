import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { setActiveProvider } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const setActiveSchema = z
  .object({
    provider: z.enum(['stripe', 'n_genius', 'ziina']),
  })
  .strict();

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { provider } = await parseRequiredBody(request, setActiveSchema);

      // Audit MED-7 (2026-05-05): the query now throws
      // `PROVIDER_NOT_ACTIVATABLE` when the target doesn't exist or
      // isn't `connected` (instead of leaving the club with no
      // active provider after a half-applied transaction). Catch it
      // here and surface as 422 with the same shape as the prior
      // null-return path.
      let result;
      try {
        result = await setActiveProvider(ctx.clubId, provider);
      } catch (err) {
        if (err instanceof Error && err.message === 'PROVIDER_NOT_ACTIVATABLE') {
          return errorResponse(
            'NOT_CONNECTED',
            `${provider} is not connected — finish onboarding before marking it active`,
            422,
          );
        }
        throw err;
      }
      if (!result) {
        // Should be unreachable now (the throw above covers the
        // not-connected case), but kept as belt-and-braces.
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
