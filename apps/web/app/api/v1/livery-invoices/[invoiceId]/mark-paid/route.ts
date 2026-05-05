import { type NextRequest, after } from 'next/server';
import {
  manualMarkLiveryInvoicePaid,
  getLiveryInvoiceForEmail,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';
import { sendTriggeredEmail } from '@/lib/email';
import { LiveryPaymentReceived } from '@equestrian/email-templates/livery-payment-received';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ invoiceId: string }>;
}

/**
 * Admin manually marks a livery invoice paid. Use case: owner paid by
 * bank transfer / cash / off-platform, so no webhook fires. Tenant-scoped:
 * the invoice's clubId must match ctx.clubId.
 *
 * Fires the payment-received email so the owner always gets a receipt —
 * same trigger key as the webhook path, so clubs that want to suppress it
 * toggle one flag in Settings → Notifications.
 */
export async function PATCH(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { invoiceId } = await params;
      const paidAt = new Date();

      const invoice = await manualMarkLiveryInvoicePaid(
        ctx.clubId,
        invoiceId,
        paidAt,
      );

      if (!invoice) {
        return errorResponse(
          'NOT_PAYABLE',
          'Invoice not found or not in a payable state',
          409,
        );
      }

      void ctx.audit({
        action: 'livery_invoice.manual_mark_paid',
        resourceType: 'livery_invoice',
        resourceId: invoiceId,
      });

      // Audit LOW-9 (2026-05-05): the receipt-email lookup and dispatch
      // both belong post-response. Previously `getLiveryInvoiceForEmail`
      // was awaited inline before `successResponse`, adding ~30-100ms
      // of DB latency to every mark-paid response just to populate an
      // email the admin doesn't see. Moving both into `after()` returns
      // the API call as soon as the DB write commits and lets the
      // receipt fan out independently. Failures are logged but do not
      // affect the response.
      after(async () => {
        try {
          const detail = await getLiveryInvoiceForEmail(ctx.clubId, invoiceId);
          if (!detail?.ownerEmail) return;
          await sendTriggeredEmail({
            clubId: ctx.clubId,
            trigger: 'livery_payment_received',
            to: detail.ownerEmail,
            subject: `Payment received — ${detail.horseName}`,
            template: LiveryPaymentReceived({
              ownerName: detail.ownerName ?? 'there',
              horseName: detail.horseName,
              clubName: detail.clubName,
              invoiceNumber: detail.invoiceNumber,
              amountMinorUnits: detail.amountMinorUnits,
              currency: detail.currency,
              paidDate: paidAt.toISOString().slice(0, 10),
            }),
          });
        } catch (err) {
          logger.error('livery_mark_paid_receipt_failed', {
            clubId: ctx.clubId,
            invoiceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      return successResponse(invoice);
    },
    {
      requiredPermission: 'finances:update',
      // Audit LOW-1 (2026-05-05): rate limit money-adjacent admin routes.
      // 10/min/user is generous for legitimate batch flows but caps any
      // runaway/abuse loop. failClosed — a Redis outage shouldn't lift
      // the cap on a manual-mark-paid endpoint.
      rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true },
      routeKey: 'livery_invoice_mark_paid',
    },
  );
}
