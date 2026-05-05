import { type NextRequest } from 'next/server';
import {
  getClubById,
  getPlatformInvoiceForEmail,
  setPlatformInvoiceProviderRef,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';
import {
  createPlatformPaymentIntent,
  PlatformZiinaError,
} from '@/lib/billing/platform-ziina';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ invoiceId: string }>;
}

/**
 * Regenerates the Ziina platform pay-link for a pending / overdue
 * platform_subscription_invoice. Used when:
 *   - The cron failed to mint a link at issue time (Ziina was down) —
 *     the invoice carries no pay_link and the admin clicks "Refresh".
 *   - The original Ziina hosted page expired before the admin paid.
 *
 * Always issues a fresh Ziina intent (idempotency key includes a
 * monotonic counter via Date.now()) and updates the invoice row via
 * `setPlatformInvoiceProviderRef`. The call refuses to act on terminal
 * (paid / cancelled) invoices — `setPlatformInvoiceProviderRef` returns
 * null in that case.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { invoiceId } = await params;

      const invoice = await getPlatformInvoiceForEmail(ctx.clubId, invoiceId);
      if (!invoice) {
        return errorResponse('NOT_FOUND', 'Invoice not found', 404);
      }
      if (invoice.paidAt) {
        return errorResponse('ALREADY_PAID', 'This invoice has already been paid', 422);
      }

      const club = await getClubById(ctx.clubId);
      if (!club) {
        return errorResponse('NOT_FOUND', 'Club not found', 404);
      }

      try {
        // Idempotency key includes Date.now() so each refresh produces a
        // fresh Ziina intent — without that, a stale (expired) intent
        // would just be returned again.
        const intent = await createPlatformPaymentIntent({
          amountMinorUnits: invoice.amountMinorUnits,
          currency: invoice.currency,
          idempotencyKey: `platform:${ctx.clubId}:${invoice.periodStart}:r${Date.now()}`,
          message: `Cavaliq subscription — ${club.name} — ${invoice.periodStart}`,
          returnUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/settings/subscription`,
        });

        const updated = await setPlatformInvoiceProviderRef(
          ctx.clubId,
          invoiceId,
          'ziina_platform',
          intent.providerPaymentId,
          intent.paymentUrl,
        );

        if (!updated) {
          return errorResponse(
            'INVOICE_TERMINAL',
            'Invoice is no longer pending — payment may have already settled',
            422,
          );
        }

        void ctx.audit({
          action: 'platform_invoice.refresh_pay_link',
          resourceType: 'platform_subscription_invoice',
          resourceId: invoiceId,
        });

        logger.info('platform_invoice_pay_link_refreshed', {
          clubId: ctx.clubId,
          invoiceId,
          providerPaymentId: intent.providerPaymentId,
        });

        return successResponse({
          payLink: intent.paymentUrl,
          providerPaymentId: intent.providerPaymentId,
        });
      } catch (err) {
        if (err instanceof PlatformZiinaError) {
          const status =
            err.code === 'PROVIDER_NOT_CONFIGURED' ? 503 :
            err.code === 'AUTH_FAILED' ? 502 :
            err.retryable ? 503 : 502;
          return errorResponse(err.code, err.message, status);
        }
        throw err;
      }
    },
    { requiredPermission: 'settings:update' },
  );
}
