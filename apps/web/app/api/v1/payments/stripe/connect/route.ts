import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';
import { stripeAdapter } from '@/lib/payments/stripe';
import { signOAuthState } from '@/lib/payments/state';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * Kicks off the Stripe Connect OAuth flow. Returns the authorize URL for the
 * client to redirect to (rather than a 302) so the caller can render a
 * confirmation UI first or handle errors inline.
 */
export async function POST() {
  return withAuth(
    async (ctx) => {
      if (!stripeAdapter.initOAuthConnection) {
        return errorResponse('NOT_SUPPORTED', 'Stripe adapter does not support OAuth', 500);
      }

      try {
        const state = signOAuthState(ctx.clubId);
        const result = await stripeAdapter.initOAuthConnection({
          clubId: ctx.clubId,
          // returnUrl isn't used by Stripe init directly — the callback route
          // decides where to send the user after completing the exchange.
          returnUrl: '/settings/payments',
          stateToken: state,
        });

        logger.info('stripe_oauth_initiated', {
          clubId: ctx.clubId,
          actorMemberId: ctx.memberId,
        });

        void ctx.audit({
          action: 'payment_account.connect_stripe',
          resourceType: 'payment_account',
        });

        return successResponse({ redirectUrl: result.redirectUrl });
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          return errorResponse(err.code, err.message, 500);
        }
        throw err;
      }
    },
    { requiredPermission: 'settings:update' },
  );
}
