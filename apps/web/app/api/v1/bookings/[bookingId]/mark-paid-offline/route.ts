import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { markBookingPaidOffline, getBookingById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

/**
 * Task #18 (2026-05-28): admin-initiated "mark paid offline" path.
 *
 * Closes the audit P2 gap where the inline row dropdown had no entry
 * for the cash / card-in-person / bank-transfer settle path — admins
 * had to go through the Add Booking dialog to set the offline method.
 *
 * PATCH /api/v1/bookings/[bookingId]/mark-paid-offline
 *
 * Body: { paymentMethod: 'cash' | 'card_in_person' | 'bank_transfer' }
 *
 * CAS in the query refuses to overwrite a paid/refunded/partial row
 * so a concurrent webhook win can't be clobbered. Re-pinning a
 * 'failed' booking to 'paid' is allowed — operator overrides the
 * provider rejection (e.g. "they paid by transfer instead"); the
 * query also clears the stale provider refs so the refund flow
 * doesn't try to refund the original failed attempt.
 *
 * Lifecycle CAS blocks `cancelled` / `no_show` / `completed` bookings
 * so a released slot can't be retroactively marked paid.
 */

// `package_credit` deliberately excluded — settling against rider
// packages needs atomic credit consumption which doesn't exist yet
// (see codex #18 P2 2026-05-28). The booking-create path blocks it
// for the same reason.
const bodySchema = z
  .object({
    paymentMethod: z.enum(['cash', 'card_in_person', 'bank_transfer']),
  })
  .strict();

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { bookingId } = await params;
      validateUuidParam('bookingId', bookingId);
      const data = await parseRequiredBody(request, bodySchema);

      const existing = await getBookingById(ctx.clubId, bookingId);
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Booking not found', 404);
      }

      const updated = await markBookingPaidOffline(ctx.clubId, bookingId, data.paymentMethod);
      if (!updated) {
        // Booking transitioned to paid/refunded/partial between the read
        // and write, or the row already settled. Surface a meaningful
        // 409 so the UI can refetch instead of blindly retrying.
        return errorResponse(
          'NOT_RECONCILABLE',
          'Booking is already settled or in a terminal payment state',
          409,
        );
      }

      void ctx.audit({
        action: 'booking.mark_paid_offline',
        resourceType: 'booking',
        resourceId: bookingId,
        changes: {
          paymentStatus: { from: existing.paymentStatus, to: 'paid' },
          paymentMethod: { from: existing.paymentMethod, to: data.paymentMethod },
        },
      });

      return successResponse(updated);
    },
    { requiredPermission: 'bookings:update' },
  );
}
