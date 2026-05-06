-- Round 6.1 — booking 24h reminder cadence.
--
-- The booking-reminder template + `notification_preferences.booking_reminder_24h`
-- have shipped since Round 4 but no cron fired the email — that's the gap
-- this round closes. The new cron at `/api/cron/booking-reminders` runs
-- hourly and looks for `confirmed` bookings whose slot starts ~24h from
-- now (in the CLUB's timezone, not UTC) that haven't yet been reminded.
--
-- A `reminder_sent_at` column on bookings dedupes — without it, a delayed
-- or doubled cron run would send the rider two reminders for the same
-- lesson. The matching mark-helper does a CAS on `IS NULL` so concurrent
-- cron invocations can't both win.
--
-- Index on (slot_id, reminder_sent_at) so the upcoming-bookings query
-- can skip already-reminded rows efficiently. Partial would be tighter
-- (`WHERE reminder_sent_at IS NULL`) but Drizzle's index builder
-- doesn't ergonomically express partial — a full-column index is fine
-- at the volume we operate at.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_bookings_slot_reminder"
  ON "bookings" ("slot_id", "reminder_sent_at");
