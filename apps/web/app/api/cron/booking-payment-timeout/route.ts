import { type NextRequest } from 'next/server';
import {
  findStalePendingPaymentBookings,
  autoCancelBookingForPaymentTimeout,
  reconcileBookingMarkPaid,
  adminGetActivePaymentAccount,
  getClubById,
} from '@equestrian/db/queries';
import { sendTriggeredEmail } from '@/lib/email';
import { BookingCancellation } from '@equestrian/email-templates/booking-cancellation';
import { errorResponse, successResponse, requireCronSecret } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { getAdapter } from '@/lib/payments/registry';
import { PaymentProviderError } from '@/lib/payments/types';

/**
 * 2026-05-16 — auto-release slots held by unpaid bookings.
 *
 * Problem: when a rider abandons the N-Genius / Ziina / Stripe Checkout
 * PayPage (or simply closes the tab), the booking stays at
 * `status='confirmed'` with `paymentStatus='pending'` forever. The slot
 * stays held, no money lands, and the club loses revenue + slot
 * inventory. True abandons never trigger a webhook so there's no
 * out-of-band signal to clear the row.
 *
 * Sweep: every 10 minutes the cron picks up bookings older than the
 * 15-minute grace period and decides per-booking:
 *
 *   1. Booking has a `providerPaymentId` → call
 *      `adapter.getPaymentStatus()` to ask the provider directly.
 *      Defends against the "webhook genuinely never landed" case where
 *      payment DID succeed — we mark `paymentStatus='paid'` and leave
 *      the booking alone. Without this safety check, a payment that
 *      succeeded but whose webhook got dropped (network blip, provider
 *      delivery glitch) would result in a paid-but-cancelled booking.
 *
 *   2. Provider says succeeded → reconcile to paid (don't cancel).
 *
 *   3. Provider says anything else (or no `providerPaymentId` because
 *      the rider never opened the pay dialog) → auto-cancel via
 *      `autoCancelBookingForPaymentTimeout` (CAS on
 *      `status='confirmed' AND paymentStatus='pending'`, releases the
 *      slot rider count), then send the rider a
 *      `booking_cancellation`-trigger email so they know the slot was
 *      released and they can re-book.
 *
 * Grace: 15 minutes from `bookings.createdAt`. Long enough for a card
 * 3DS / OTP flow, short enough that the slot is freed within the next
 * cron tick (so worst-case lag is ~25 min: 15 grace + 10 cron period).
 *
 * Idempotency: the auto-cancel CAS requires `status='confirmed' AND
 * paymentStatus='pending'`, so a booking that flipped to paid (or was
 * manually cancelled) between the query and the update returns null
 * from the helper and the email send is skipped.
 *
 * Provider lookup: clubs may have switched providers since the booking
 * was minted (rare). We look up the currently-active account; if the
 * booking's `paymentProvider` doesn't match, we skip the
 * `getPaymentStatus` step and fall through to auto-cancel — the
 * stale provider's intent is unreachable, and treating the booking
 * as abandoned is the safe move.
 */

const GRACE_MINUTES = 15;

interface CronResult {
  considered: number;
  reconciledPaid: number;
  autoCancelled: number;
  skipped: number;
  errors: number;
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireCronSecret(request, 'booking_payment_timeout_cron');
  if (unauthorized) return unauthorized;

  logger.info('booking_payment_timeout_cron_started');
  const now = new Date();

  try {
    const result = await runSweep(now);
    logger.info('booking_payment_timeout_cron_completed', {
      now: now.toISOString(),
      ...result,
    });
    return successResponse({ now: now.toISOString(), ...result });
  } catch (err) {
    logger.error('booking_payment_timeout_cron_failed', {
      now: now.toISOString(),
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('CRON_FAILED', 'Cron run failed', 500);
  }
}

async function runSweep(now: Date): Promise<CronResult> {
  const candidates = await findStalePendingPaymentBookings(now, GRACE_MINUTES);
  let reconciledPaid = 0;
  let autoCancelled = 0;
  let skipped = 0;
  let errors = 0;

  // Cache club lookups — many bookings share a club; the club row also
  // gates the cancellation-email subject line (club name) and notification
  // preference (`booking_cancellation.email`). Matches the
  // `findUpcomingBookingsForReminder` pattern.
  const clubCache = new Map<string, Awaited<ReturnType<typeof getClubById>>>();

  for (const booking of candidates) {
    try {
      // Step 1: provider safety check — if the booking has a provider
      // intent, ask the provider directly. Skips when the booking
      // never got past `setBookingPaymentRef` (rider closed the pay
      // dialog before clicking Pay).
      if (booking.paymentProvider && booking.providerPaymentId) {
        const account = await adminGetActivePaymentAccount(booking.clubId);
        // Account mismatch (club switched providers since the booking
        // was minted) → can't reconcile via the new account's adapter.
        // Treat as abandoned and fall through to auto-cancel.
        if (account && account.provider === booking.paymentProvider) {
          try {
            const adapter = getAdapter(account.provider);
            const status = await adapter.getPaymentStatus({
              account,
              providerPaymentId: booking.providerPaymentId,
            });
            if (status.status === 'succeeded') {
              // Webhook genuinely never landed but the money DID arrive.
              // Reconcile to paid; do NOT cancel.
              const reconciled = await reconcileBookingMarkPaid(
                booking.clubId,
                booking.bookingId,
              );
              if (reconciled) {
                reconciledPaid += 1;
                logger.warn('booking_payment_reconciled_from_provider', {
                  bookingId: booking.bookingId,
                  clubId: booking.clubId,
                  provider: booking.paymentProvider,
                  providerPaymentId: booking.providerPaymentId,
                  note: 'Webhook never landed; provider getPaymentStatus surfaced succeeded state. Booking marked paid without cron auto-cancel.',
                });
              } else {
                // CAS lost — concurrent webhook updated the row first.
                // No-op; the webhook handled it.
                skipped += 1;
              }
              continue;
            }
          } catch (providerErr) {
            // Provider call failed — log and fall through to
            // auto-cancel. Erring on the side of releasing the slot
            // matches the original-bug priority (slot inventory
            // matters more than the rare network-flaky case).
            if (providerErr instanceof PaymentProviderError) {
              logger.warn('booking_payment_timeout_provider_status_failed', {
                bookingId: booking.bookingId,
                clubId: booking.clubId,
                provider: booking.paymentProvider,
                code: providerErr.code,
                message: providerErr.message,
              });
            } else {
              throw providerErr;
            }
          }
        }
      }

      // Step 2: auto-cancel. CAS-protected, so a concurrent webhook
      // that flipped paymentStatus to paid between query and update
      // wins and returns null here.
      const cancelled = await autoCancelBookingForPaymentTimeout(
        booking.clubId,
        booking.bookingId,
        'Payment was not completed within the grace window. The slot has been released.',
      );
      if (!cancelled) {
        skipped += 1;
        continue;
      }
      autoCancelled += 1;

      // Step 3: notify the rider. Reuse the existing BookingCancellation
      // template + `booking_cancellation` trigger — the club's
      // notification preference for cancellations applies here.
      let club = clubCache.get(booking.clubId);
      if (club === undefined) {
        club = await getClubById(booking.clubId);
        clubCache.set(booking.clubId, club);
      }
      if (!club) {
        // Club row missing (soft-deleted between query and email send).
        // Cancel is done; just skip the email.
        logger.warn('booking_payment_timeout_email_skipped_no_club', {
          bookingId: booking.bookingId,
          clubId: booking.clubId,
        });
        continue;
      }

      const recipientEmail = booking.isGuestBooking ? booking.guestEmail : booking.riderEmail;
      const recipientName = booking.isGuestBooking
        ? (booking.guestName ?? 'Guest')
        : (booking.riderName ?? 'there');

      if (!recipientEmail) {
        // No address to send to (guest booking without contact info, or
        // member with no email column). Cancellation already done.
        logger.info('booking_payment_timeout_email_skipped_no_recipient', {
          bookingId: booking.bookingId,
          clubId: booking.clubId,
          isGuestBooking: booking.isGuestBooking,
        });
        continue;
      }

      const sendResult = await sendTriggeredEmail({
        clubId: booking.clubId,
        trigger: 'booking_cancellation',
        to: recipientEmail,
        subject: `Booking cancelled — payment not completed`,
        template: BookingCancellation({
          riderName: recipientName,
          lessonType: booking.lessonTypeName,
          date: booking.slotDate,
          time: booking.slotStartTime,
          arena: booking.arenaName ?? 'TBD',
          clubName: club.name,
          clubLogo: club.logoUrl ?? undefined,
          reason:
            'Payment was not completed within 15 minutes of booking, so we released the slot. You can re-book any time from the app.',
          type: 'cancellation',
        }),
      });

      if (!sendResult.sent && !sendResult.skipped) {
        logger.warn('booking_payment_timeout_email_send_failed', {
          bookingId: booking.bookingId,
          clubId: booking.clubId,
          error: sendResult.error,
        });
      }
    } catch (err) {
      errors += 1;
      logger.error('booking_payment_timeout_booking_failed', {
        bookingId: booking.bookingId,
        clubId: booking.clubId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  return {
    considered: candidates.length,
    reconciledPaid,
    autoCancelled,
    skipped,
    errors,
  };
}
