-- 2026-05-06 audit (round 2). Closes F-18.
--
-- Application logic enforces nonneg amounts on every write path, but
-- migration 0025 (`business_invariant_checks`) didn't cover the three
-- bookings money columns. Adding DB-level CHECKs as defense-in-depth:
-- a direct DB write or a future bug that bypasses the route layer
-- can't store a negative.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_amount_nonneg') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amount_nonneg"
    CHECK (amount IS NULL OR amount >= 0);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_discount_nonneg') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_discount_nonneg"
    CHECK (discount_amount >= 0);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancellation_fee_nonneg') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancellation_fee_nonneg"
    CHECK (cancellation_fee IS NULL OR cancellation_fee >= 0);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_refunded_minor_nonneg') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_refunded_minor_nonneg"
    CHECK (refunded_amount_minor >= 0);
END IF; END $$;
