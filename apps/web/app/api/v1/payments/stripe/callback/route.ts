import { type NextRequest, NextResponse } from 'next/server';
import { runInTenantContext } from '@equestrian/db';
import { upsertPaymentAccount } from '@equestrian/db/queries';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';
import { stripeAdapter } from '@/lib/payments/stripe';
import { verifyOAuthState } from '@/lib/payments/state';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

/**
 * Stripe sends the admin back here with `code` and `state`. We verify the
 * state (CSRF + binding to the initiating club), then exchange the code for
 * a connected-account id and persist it. Regardless of outcome, we redirect
 * to `/settings/payments` with a status query param so the UI can show a
 * toast/banner.
 */

function redirectBack(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL('/settings/payments', origin);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  // Stripe sends either { code, state } on success or { error, state } on denial.
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const stripeError = request.nextUrl.searchParams.get('error');

  if (stripeError) {
    logger.warn('stripe_oauth_denied', { error: stripeError });
    return redirectBack(origin, { status: 'denied', error: stripeError });
  }

  if (!code || !state) {
    return redirectBack(origin, { status: 'error', error: 'missing_parameters' });
  }

  const verifiedState = verifyOAuthState(state);
  if (!verifiedState) {
    logger.warn('stripe_oauth_state_invalid');
    return redirectBack(origin, { status: 'error', error: 'invalid_state' });
  }

  // Make sure the caller is still logged into the same club they initiated
  // the flow from. Clerk session cookie rides along on the redirect.
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof TenantError) {
      return redirectBack(origin, { status: 'error', error: 'not_authenticated' });
    }
    throw err;
  }

  if (ctx.clubId !== verifiedState.clubId) {
    logger.warn('stripe_oauth_club_mismatch', {
      stateClubId: verifiedState.clubId,
      sessionClubId: ctx.clubId,
    });
    return redirectBack(origin, { status: 'error', error: 'club_mismatch' });
  }

  if (!hasPermission(ctx.orgRole, 'settings:update')) {
    return redirectBack(origin, { status: 'error', error: 'forbidden' });
  }

  try {
    const callbackResult = await stripeAdapter.completeOAuthCallback!({ code });

    // Persist inside the tenant tx so the insert is covered by RLS.
    await runInTenantContext(ctx.clubId, async () => {
      await upsertPaymentAccount(ctx.clubId, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: callbackResult.externalAccountId,
        credentials: null,
        metadata: callbackResult.metadata,
        makeActive: true,
      });
    });

    logger.info('stripe_oauth_completed', {
      clubId: ctx.clubId,
      stripeAccountId: callbackResult.externalAccountId,
      chargesEnabled: callbackResult.metadata.chargesEnabled ?? null,
    });

    return redirectBack(origin, { status: 'connected', provider: 'stripe' });
  } catch (err) {
    const message = err instanceof PaymentProviderError ? err.code : 'exchange_failed';
    logger.error('stripe_oauth_exchange_failed', {
      clubId: ctx.clubId,
      error: err instanceof Error ? err.message : 'unknown',
      code: message,
    });
    return redirectBack(origin, { status: 'error', error: message });
  }
}
