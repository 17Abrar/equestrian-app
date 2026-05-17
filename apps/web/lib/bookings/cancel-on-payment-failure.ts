import {
  autoCancelBookingForPaymentFailure,
  getBookingForCancellationEmail,
  getClubById,
} from '@equestrian/db/queries';
import { sendTriggeredEmail } from '@/lib/email';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';
import { logger } from '@/lib/logger';

/**
 * 2026-05-17 — shared cancellation path for payment failures. Called
 * from two sites:
 *
 *   1. Webhook handler (apps/web/lib/payments/webhook-helpers.ts): a
 *      provider event flipped `paymentStatus` to `failed` (DECLINED,
 *      CANCELLED, etc.). The rider tried, the card was refused; no
 *      reason to keep their slot.
 *
 *   2. Create-intent route (apps/web/app/api/v1/bookings/[id]/payment):
 *      the adapter threw a PaymentProviderError after retries were
 *      exhausted. The booking exists from the prior
 *      `POST /api/v1/bookings` call but the provider intent could not
 *      be minted. Release the slot rather than leaving it held with
 *      no payment path.
 *
 * The DB helper `autoCancelBookingForPaymentFailure` is CAS-protected
 * on `status='confirmed' AND paymentStatus IN ('pending', 'failed')`
 * so concurrent invocations from the two sites can't double-cancel,
 * and a rider who paid successfully between the failed attempt and
 * this call won't have their booking pulled out from under them.
 *
 * The email reuses the existing `BookingCancellation` template +
 * `booking_cancellation` notification trigger so the club's existing
 * opt-out preference applies. The notification preference is the
 * gate, not a separate flag — auto-cancellation IS a cancellation
 * from the rider's perspective. Offline bookings never enter this
 * path because the create-intent route filters them upfront and
 * webhooks for offline payments aren't a thing.
 *
 * Returns `cancelled: true` when the CAS won and we should treat the
 * booking as released; `false` when another writer beat us (already
 * paid, manually cancelled, etc.). Email failure does NOT roll back
 * the cancel — the cancel has higher priority than the notification.
 */
export async function cancelBookingForPaymentFailure(params: {
  clubId: string;
  bookingId: string;
  reason: string;
  /** Origin of the failure — only used in the log, not the user-facing
   *  email copy. Helps an operator trace whether webhooks or the
   *  create-intent path is firing this. */
  source: 'webhook' | 'create_intent';
  /** Additional fields to fold into the cancel log. Typical: requestId,
   *  provider, providerPaymentId, error code. */
  logContext?: Record<string, unknown>;
}): Promise<{ cancelled: boolean }> {
  const { clubId, bookingId, reason, source, logContext } = params;

  const cancelled = await autoCancelBookingForPaymentFailure(clubId, bookingId, reason);
  if (!cancelled) {
    // CAS lost — most commonly a concurrent webhook flipped the
    // status to `paid` (race between the create-intent error path
    // and a late-arriving success webhook). Log at info so it's
    // visible without alarming.
    logger.info('booking_payment_failure_cancel_skipped', {
      clubId,
      bookingId,
      source,
      reason,
      ...logContext,
    });
    return { cancelled: false };
  }

  logger.info('booking_payment_failure_cancelled', {
    clubId,
    bookingId,
    source,
    reason,
    ...logContext,
  });

  // Email the rider. Best-effort: if the lookup fails or the address
  // is missing (guest booking with no email), log and move on — the
  // cancellation is already committed and the rider can see the state
  // change in the app.
  try {
    const bookingCtx = await getBookingForCancellationEmail(clubId, bookingId);
    if (!bookingCtx) {
      logger.warn('booking_payment_failure_email_skipped_no_booking', { clubId, bookingId });
      return { cancelled: true };
    }
    const club = await getClubById(clubId);
    if (!club) {
      logger.warn('booking_payment_failure_email_skipped_no_club', { clubId, bookingId });
      return { cancelled: true };
    }
    const recipientEmail = bookingCtx.isGuestBooking
      ? bookingCtx.guestEmail
      : bookingCtx.riderEmail;
    const recipientName = bookingCtx.isGuestBooking
      ? (bookingCtx.guestName ?? 'Guest')
      : (bookingCtx.riderName ?? 'there');

    if (!recipientEmail) {
      logger.info('booking_payment_failure_email_skipped_no_recipient', {
        clubId,
        bookingId,
        isGuestBooking: bookingCtx.isGuestBooking,
      });
      return { cancelled: true };
    }

    const sendResult = await sendTriggeredEmail({
      clubId,
      trigger: 'booking_cancellation',
      to: recipientEmail,
      subject: `Booking cancelled — payment not completed`,
      template: BookingCancellation({
        riderName: recipientName,
        lessonType: bookingCtx.lessonTypeName,
        date: bookingCtx.slotDate,
        time: bookingCtx.slotStartTime,
        arena: bookingCtx.arenaName ?? 'TBD',
        clubName: club.name,
        clubLogo: club.logoUrl ?? undefined,
        reason:
          'Your payment didn’t go through and we released the slot. You can re-book any time from the app.',
        type: 'cancellation',
      }),
    });
    if (!sendResult.sent && !sendResult.skipped) {
      logger.warn('booking_payment_failure_email_send_failed', {
        clubId,
        bookingId,
        error: sendResult.error,
      });
    }
  } catch (err) {
    logger.error('booking_payment_failure_email_unexpected_error', {
      clubId,
      bookingId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  return { cancelled: true };
}
