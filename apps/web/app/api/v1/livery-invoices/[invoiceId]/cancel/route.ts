import { type NextRequest } from 'next/server';
import { cancelLiveryInvoice } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ invoiceId: string }>;
}

/**
 * Admin cancels a livery invoice. Only pending/overdue invoices can be
 * cancelled — paid ones must go through refund instead.
 */
export async function PATCH(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { invoiceId } = await params;
      const invoice = await cancelLiveryInvoice(ctx.clubId, invoiceId);

      if (!invoice) {
        return errorResponse(
          'NOT_CANCELLABLE',
          'Invoice not found or not in a cancellable state',
          409,
        );
      }

      void ctx.audit({
        action: 'livery_invoice.cancel',
        resourceType: 'livery_invoice',
        resourceId: invoiceId,
      });

      return successResponse(invoice);
    },
    { requiredPermission: 'finances:update' },
  );
}
