-- Per-booking running total of successfully refunded minor units.
--
-- Before this column, a partial refund flipped `payment_status` to
-- `refunded` — which (a) blocked any subsequent partial refund because
-- the refund route gates on `paymentStatus === 'paid'`, and (b) made
-- the rider UI advertise the booking as "fully refunded" even when
-- only a goodwill 20 AED was returned on a 100 AED lesson.
--
-- Now: the refund route accumulates `refunded_amount_minor` on each
-- successful provider call and sets status to 'partial' while
-- refunded < amount, 'refunded' once refunded === amount.
--
-- Backfill: existing 'refunded' rows default to 0 because we don't
-- have historical refund amounts. New refunds correctly populate this
-- column going forward.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "refunded_amount_minor" integer NOT NULL DEFAULT 0;
