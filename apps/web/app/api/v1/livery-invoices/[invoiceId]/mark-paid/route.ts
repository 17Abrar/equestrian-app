import { type NextRequest } from 'next/server';
import {
  manualMarkLiveryInvoicePaid,
  getLiveryInvoiceForEmail,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { LiveryPaymentReceived } from '@equestrian/email-templates/livery-payment-received';

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

      // Send the receipt using the same notification trigger the webhook
      // path uses, so clubs only have to toggle one preference to silence
      // the flow.
      const detail = await getLiveryInvoiceForEmail(ctx.clubId, invoiceId);
      if (detail?.ownerEmail) {
        sendTriggeredEmailAsync({
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
      }

      return successResponse(invoice);
    },
    { requiredPermission: 'finances:update' },
  );
}
