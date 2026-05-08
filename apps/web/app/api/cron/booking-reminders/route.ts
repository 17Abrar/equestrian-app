import { type NextRequest } from 'next/server';
import {
  findUpcomingBookingsForReminder,
  markBookingReminderSent,
  unmarkBookingReminderSent,
  getClubById,
  getMemberByIdIncludingDeactivated,
} from '@equestrian/db/queries';
import { sendTriggeredEmail } from '@/lib/email';
import { BookingReminder } from '@equestrian/email-templates/booking-reminder';
import { errorResponse, successResponse, requireCronSecret } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { MS_PER_HOUR } from '@equestrian/shared/constants';

/**
 * Round 6.1 — hourly cron that sends a 24h-before-lesson reminder to
 * the rider (or guest's email when the booking is a guest booking).
 *
 * Why hourly: the cron needs to hit the [now+23h, now+25h] window in
 * each club's local timezone. Daily-only would miss bookings in
 * non-UTC clubs (e.g. an Asia/Dubai club with a lesson at 10:00 local
 * is 06:00 UTC, so a 02:00 UTC daily cron looking for ~24h ahead would
 * see it at the wrong cadence half the year). Hourly with a 2-hour
 * window catches every booking exactly once.
 *
 * Dedup: `bookings.reminder_sent_at` (added in migration 0036) is
 * NULL until this cron sends, then stamped with `now()`. The mark-
 * helper does a CAS on `IS NULL` so a doubled cron run can't double-
 * send. Cancelled slots and non-confirmed bookings are filtered at
 * the query layer.
 *
 * Notification preferences: gated on
 * `clubs.notification_preferences.booking_reminder_24h.email` —
 * default-on, but a club admin can flip it off in Settings →
 * Notifications. Looked up per-booking via the club's preferences (the
 * default is permissive: when the key is missing, treat as enabled).
 */
export async function POST(request: NextRequest) {
  // Audit F-21 (2026-05-06): centralized cron-secret guard.
  const unauthorized = await requireCronSecret(request, 'booking_reminder_cron');
  if (unauthorized) return unauthorized;

  // Audit F-15 (2026-05-06): see livery cron for rationale.
  logger.info('booking_reminder_cron_started');

  const now = new Date();

  try {
    const result = await sendBookingReminders(now);

    logger.info('booking_reminder_cron_completed', {
      now: now.toISOString(),
      sent: result.sent,
      skipped: result.skipped,
      considered: result.considered,
    });

    return successResponse({
      now: now.toISOString(),
      ...result,
    });
  } catch (err) {
    logger.error('booking_reminder_cron_failed', {
      now: now.toISOString(),
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('CRON_FAILED', 'Cron run failed', 500);
  }
}

interface SendResult {
  sent: number;
  skipped: number;
  considered: number;
}

async function sendBookingReminders(now: Date): Promise<SendResult> {
  const candidates = await findUpcomingBookingsForReminder(now);
  let sent = 0;
  let skipped = 0;

  // Cache club lookups across the loop — multiple bookings often share
  // a club, and getClubById is a tenant-scoped network round-trip.
  const clubCache = new Map<string, Awaited<ReturnType<typeof getClubById>>>();

  for (const booking of candidates) {
    // Audit F-63 (2026-05-08 r6): hoist `hoursFromNow` above the try so
    // the catch-side `booking_reminder_send_failed` log can include it.
    // Computed inside the try once the slot instant resolves.
    let hoursFromNow = NaN;
    try {
      // Resolve the slot's instant in the club's timezone.
      let club = clubCache.get(booking.clubId);
      if (club === undefined) {
        club = await getClubById(booking.clubId);
        clubCache.set(booking.clubId, club);
      }
      if (!club) {
        skipped += 1;
        continue;
      }

      // Notification preference gate. When missing or `email !== false`,
      // treat as enabled. Defaults across the codebase use this
      // permissive shape; a club must explicitly opt out by setting
      // `{ email: false }` to suppress the reminder.
      const prefs = club.notificationPreferences ?? {};
      const reminderPref = prefs.booking_reminder_24h;
      if (reminderPref && reminderPref.email === false) {
        skipped += 1;
        continue;
      }

      // Convert slot date+time → an instant in the club's TZ. We use
      // the well-tested `Intl.DateTimeFormat` round-trip pattern: build
      // the local datetime string, then construct a Date assuming the
      // club's offset. For DST-observing zones a small drift is
      // possible at the spring-forward boundary; Asia/Dubai (our
      // primary tenant) doesn't observe DST so this is exact today.
      // Audit F-45 (2026-05-07 r4): the matching window below was
      // widened from 23-25h to 22-26h to absorb that 1h DST drift
      // without missing reminders. Dedup is preserved via the CAS on
      // `reminder_sent_at` (only the first run that lands in the
      // widened window successfully claims the booking).
      const slotInstant = resolveSlotInstant(
        booking.slotDate,
        booking.slotStartTime,
        club.timezone,
      );
      if (!slotInstant) {
        logger.warn('booking_reminder_invalid_slot_instant', {
          bookingId: booking.bookingId,
          clubId: booking.clubId,
          slotDate: booking.slotDate,
          slotStartTime: booking.slotStartTime,
          timezone: club.timezone,
        });
        skipped += 1;
        continue;
      }

      // Window: 22-26 hours from now (widened per F-45 to absorb DST
      // spring-forward drift). The hourly cron schedule means a single
      // booking falls into multiple consecutive runs' windows; the CAS
      // on `reminder_sent_at` ensures only the first run that wins the
      // UPDATE actually sends.
      hoursFromNow = (slotInstant.getTime() - now.getTime()) / MS_PER_HOUR;
      // F-45 (2026-05-07 r4): widen [23..25] → [22..26] so DST spring-
      // forward / fall-back boundaries don't slip a single hourly cron
      // pass and miss the only reminder send for that booking. The CAS
      // on `reminder_sent_at` still prevents duplicate sends.
      if (hoursFromNow < 22 || hoursFromNow > 26) {
        skipped += 1;
        continue;
      }

      // Recipient: guest email when isGuestBooking, otherwise rider.
      const recipientEmail = booking.isGuestBooking
        ? booking.guestEmail
        : booking.riderEmail;
      const recipientName = booking.isGuestBooking
        ? booking.guestName ?? 'Guest'
        : booking.riderName ?? 'there';
      if (!recipientEmail) {
        // Audit LOW (2026-05-06): the previous shape called
        // `markBookingReminderSent` here so the cron wouldn't
        // re-consider the booking every hour. But that permanently
        // dedup'd a booking whose rider had no email at the moment of
        // the cron pass — if the parent later adds a contact email,
        // the reminder never fires. Just `continue` instead: the
        // booking falls out of the [now+23h, now+25h] window naturally
        // once the slot start time passes, so re-considering it across
        // the few hourly passes between now and then is cheap and
        // gives a late-added email a chance to receive the reminder.
        skipped += 1;
        continue;
      }

      // CAS first, send second — if a sibling cron invocation already
      // claimed this booking, skip without sending. The previous
      // ordering (send → mark) had a small window where a doubled run
      // would double-send.
      const claimed = await markBookingReminderSent(
        booking.clubId,
        booking.bookingId,
      );
      if (!claimed) {
        skipped += 1;
        continue;
      }

      // Coach name resolution — optional, leave undefined when the
      // slot has no coach assigned.
      let coachName: string | undefined;
      if (booking.coachMemberId) {
        // Audit F-30 (2026-05-07 r4): historical lookup — the coach
        // may have been deactivated between booking creation and the
        // reminder cron pass; the booking still occurs and the rider
        // should still see the coach's name on the reminder.
        const coach = await getMemberByIdIncludingDeactivated(
          booking.clubId,
          booking.coachMemberId,
        );
        coachName = coach?.displayName ?? undefined;
      }

      await sendTriggeredEmail({
        clubId: booking.clubId,
        trigger: 'booking_reminder_24h',
        to: recipientEmail,
        subject: `Reminder: your lesson tomorrow at ${club.name}`,
        template: BookingReminder({
          riderName: recipientName,
          lessonType: booking.lessonTypeName,
          date: String(booking.slotDate),
          time: String(booking.slotStartTime),
          coachName,
          arena: booking.arenaName ?? undefined,
          clubName: club.name,
          clubLogo: club.logoUrl ?? undefined,
        }),
      });
      // Audit F-63 (2026-05-08 r6): success-side log with `hoursFromNow`
      // so the operator dashboard can distribution-plot how reminders
      // land relative to the 22-26h window. A skewed distribution (e.g.
      // every send at 25.x hours) signals a cron-schedule misalignment.
      logger.info('booking_reminder_sent', {
        bookingId: booking.bookingId,
        clubId: booking.clubId,
        hoursFromNow: Math.round(hoursFromNow * 10) / 10,
      });
      sent += 1;
    } catch (err) {
      // Audit F-16 (2026-05-07 r4): reverse the CAS so the next cron
      // pass within the 23-25h window re-attempts. The internal
      // `sendWithRetry` already exhausts transient retries; if we
      // got here, either the failure is permanent (bad email, DKIM,
      // suspended account — operator handles via the error log) or
      // transient at the infra layer (temporary Resend outage that
      // outlasted the retry window). Reversing the CAS is correct
      // for the latter and harmless for the former (next pass logs
      // the same error). Without the reversal, a Resend blip during
      // the cron's hourly fire silently swallows the reminder.
      const unclaimed = await unmarkBookingReminderSent(
        booking.clubId,
        booking.bookingId,
      ).catch(() => null);
      logger.error('booking_reminder_send_failed', {
        bookingId: booking.bookingId,
        clubId: booking.clubId,
        // Audit F-63 (2026-05-08 r6): tag with `hoursFromNow` so the
        // operator dashboard can distinguish a send-side failure (every
        // hour during 22-26h window) from a window-edge skip (one-off
        // 22h or 26h boundary).
        hoursFromNow: Math.round(hoursFromNow * 10) / 10,
        error: err instanceof Error ? err.message : 'unknown',
        casReversed: unclaimed !== null,
      });
      skipped += 1;
    }
  }

  return { sent, skipped, considered: candidates.length };
}

/**
 * Build a UTC `Date` representing the slot's start instant in the club's
 * timezone. Handles the date+time string → instant conversion using
 * `Intl.DateTimeFormat`'s offset for the given zone. Returns null on
 * invalid inputs.
 */
function resolveSlotInstant(
  slotDate: string | Date,
  slotStartTime: string,
  timezone: string,
): Date | null {
  const dateIso =
    typeof slotDate === 'string' ? slotDate : slotDate.toISOString().slice(0, 10);
  // slotStartTime can be 'HH:MM' or 'HH:MM:SS'.
  const timeMatch = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(slotStartTime);
  if (!timeMatch) return null;
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);

  // Construct the wall-clock datetime as if it were UTC, then subtract
  // the offset for the named zone at that wall-clock to get the real
  // UTC instant. Iterates once because `Intl.DateTimeFormat`'s offset
  // can shift at DST boundaries — for the wall-clock 02:30 on a
  // spring-forward day, the first guess might land in the missing
  // hour. The single re-resolve is sufficient for non-fold inputs.
  const wallAsUtc = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
    hh,
    mm,
  );
  const offsetMs = getTimeZoneOffsetMs(new Date(wallAsUtc), timezone);
  return new Date(wallAsUtc - offsetMs);
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - date.getTime();
}
