import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  adminGetPaymentAccountByProvider,
  getBookingById,
  setBookingPaymentRef,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  /**
   * Partial refund amount in minor units (fils). Omit for a full refund.
   * Must be <= the booking's captured amount.
   */
  amountMinorUnits: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

/**
 * Admin-initiated refund. Calls the provider that captured the original
 * payment (Stripe / N-Genius / Ziina) via its adapter, then updates the
 * booking's `paymentStatus` to `refunded`. The provider's refund webhook
 * will arrive later and the idempotent webhook path will recognise the
 * booking is already in `refunded` — a no-op.
 *
 * Full refund path — partial refunds update the same status but you can
 * track the difference via `booking.amount` vs provider's reported refund
 * total. A follow-up migration could add a `refunds` table for a formal
 * partial-refund ledger if needed.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;

      const raw = await request.json().catch(() => ({}));
      const data = validateInput(bodySchema, raw);

      const booking = await getBookingById(ctx.clubId, bookingId);
      if (!booking) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      if (booking.paymentStatus !== 'paid') {
        return errorResponse(
          'NOT_PAID',
          `Booking payment status is "${booking.paymentStatus}" — only paid bookings can be refunded.`,
          422,
        );
      }

      if (!booking.paymentProvider || !booking.providerPaymentId) {
        return errorResponse(
          'NO_PROVIDER_REFERENCE',
          'Booking has no payment provider reference. Refund manually from the provider dashboard.',
          422,
        );
      }

      if (data.amountMinorUnits && booking.amount && data.amountMinorUnits > booking.amount) {
        return errorResponse(
          'AMOUNT_EXCEEDS_PAYMENT',
          'Refund amount cannot exceed the original payment.',
          422,
        );
      }

      const provider = booking.paymentProvider as 'stripe' | 'n_genius' | 'ziina';
      // Fetch the account the payment was captured on — may differ from the
      // currently active provider if the club has since switched.
      const account = await adminGetPaymentAccountByProvider(ctx.clubId, provider);
      if (!account) {
        return errorResponse(
          'PROVIDER_ACCOUNT_NOT_FOUND',
          `The ${provider} account this payment was captured on is no longer connected.`,
          422,
        );
      }

      const adapter = getAdapter(provider);

      try {
        const refund = await adapter.refund({
          account,
          providerPaymentId: booking.providerPaymentId,
          amountMinorUnits: data.amountMinorUnits,
          reason: data.reason,
          // Idempotent — replays with the same key return the same refund.
          idempotencyKey: `refund_${bookingId}_${randomUUID()}`,
        });

        // Flip the booking to refunded immediately — the webhook that lands
        // later is a no-op because the status is already terminal.
        await setBookingPaymentRef(ctx.clubId, bookingId, {
          paymentStatus: 'refunded',
        });

        logger.info('booking_refunded', {
          requestId: ctx.requestId,
          bookingId,
          clubId: ctx.clubId,
          provider,
          providerRefundId: refund.providerRefundId,
          refundStatus: refund.status,
          partial: !!data.amountMinorUnits,
        });

        void ctx.audit({
          action: 'booking.refund',
          resourceType: 'booking',
          resourceId: bookingId,
        });

        return successResponse({
          bookingId,
          provider,
          providerRefundId: refund.providerRefundId,
          status: refund.status,
          partial: !!data.amountMinorUnits,
        });
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          logger.warn('booking_refund_provider_error', {
            bookingId,
            clubId: ctx.clubId,
            provider,
            code: err.code,
            message: err.message,
          });
          return errorResponse(err.code, err.message, 502);
        }
        throw err;
      }
    },
    { requiredPermission: 'bookings:update' },
  );
}
