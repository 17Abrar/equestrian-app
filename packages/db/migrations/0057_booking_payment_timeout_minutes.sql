-- 2026-05-16 — per-club tunable payment timeout grace window.
--
-- The `booking-payment-timeout` cron (added 2026-05-16) auto-releases
-- slots whose payment never settled within a grace window after booking
-- creation. Pre-fix the grace was a hardcoded 15-minute constant in the
-- cron route; this migration moves it to a per-club setting so:
--
--  - Clubs with slow card flows (long OTP / 3DS UX) can extend the window.
--  - Clubs with high double-booking pressure can shrink it.
--
-- Default 15 min preserves the prior global behavior. The cron's safety
-- check via `getPaymentStatus` still defends against the rare
-- "webhook never landed but payment DID succeed" case at any timeout
-- value.
--
-- Idempotent: column add is guarded by IF NOT EXISTS. CHECK constraint
-- pins to a sane range (1 minute is too tight to let a 3DS round-trip
-- complete; 60 minutes is too generous before the slot is meaningfully
-- "abandoned").

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS booking_payment_timeout_minutes integer NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clubs_booking_payment_timeout_minutes_range'
  ) THEN
    ALTER TABLE clubs
      ADD CONSTRAINT clubs_booking_payment_timeout_minutes_range
      CHECK (booking_payment_timeout_minutes BETWEEN 1 AND 60);
  END IF;
END $$;
