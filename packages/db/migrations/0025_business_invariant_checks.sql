-- Audit AI-22 — DB CHECK constraints for invariants the application code
-- already asserts but the DB does not enforce. Each constraint is named
-- with the audit category for traceability. All ALTERs are idempotent
-- via DROP CONSTRAINT IF EXISTS so re-running is safe.
--
-- The data-backfill statements at the top close the gap left by
-- migration 0014_booking_refunded_amount (legacy `refunded` rows have
-- refunded_amount_minor=0) and any drift in booking_slots.current_riders
-- before the constraint takes hold.

-- ─── Pre-flight backfill ──────────────────────────────────────────────

-- Migration 0014 set refunded_amount_minor=0 for legacy 'refunded' rows.
-- Restore the invariant before adding the CHECK constraint below.
UPDATE "bookings"
   SET "refunded_amount_minor" = "amount"
 WHERE "payment_status" = 'refunded'
   AND "refunded_amount_minor" = 0
   AND "amount" IS NOT NULL;

-- Cap any drifted current_riders so the bounds CHECK applies cleanly.
UPDATE "booking_slots"
   SET "current_riders" = LEAST("current_riders", "max_riders")
 WHERE "current_riders" > "max_riders";

UPDATE "booking_slots"
   SET "current_riders" = 0
 WHERE "current_riders" < 0;

-- ─── Refund ledger invariants ─────────────────────────────────────────

-- AI-22 / KP-7 — refunded amount must never exceed the original amount.
-- The comment in packages/db/src/queries/bookings.ts:622 advertised this
-- as a "belt-and-braces guard" that didn't exist in the DB; this fixes it.
ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_refund_le_amount_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_refund_le_amount_check"
  CHECK ("refunded_amount_minor" >= 0
         AND "refunded_amount_minor" <= COALESCE("amount", 0));

ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_refund_le_amount_check";
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refund_le_amount_check"
  CHECK (COALESCE("refunded_amount", 0) >= 0
         AND COALESCE("refunded_amount", 0) <= "amount");

-- ─── Slot capacity bounds ─────────────────────────────────────────────

-- AI-22 — cancelBooking uses GREATEST(...,0) precisely because no DB
-- guard existed; this adds it.
ALTER TABLE "booking_slots"
  DROP CONSTRAINT IF EXISTS "booking_slots_current_riders_bounds_check";
ALTER TABLE "booking_slots"
  ADD CONSTRAINT "booking_slots_current_riders_bounds_check"
  CHECK ("current_riders" >= 0 AND "current_riders" <= "max_riders");

-- ─── Coupon discount-value bounds ─────────────────────────────────────

-- AI-22 — coupon discount value bounds, discriminated by type.
-- Percentage in [1,100]; fixed in [1,+∞) minor units.
ALTER TABLE "coupons"
  DROP CONSTRAINT IF EXISTS "coupons_discount_value_bounds_check";
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_discount_value_bounds_check"
  CHECK (
    ("discount_type" = 'percentage' AND "discount_value" BETWEEN 1 AND 100)
    OR
    ("discount_type" = 'fixed' AND "discount_value" >= 1)
  );

-- ─── Non-negative monetary fields ─────────────────────────────────────

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_cancellation_fee_nonneg_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_cancellation_fee_nonneg_check"
  CHECK (COALESCE("cancellation_fee", 0) >= 0);

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_discount_amount_nonneg_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_discount_amount_nonneg_check"
  CHECK (COALESCE("discount_amount", 0) >= 0);

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_application_fee_nonneg_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_application_fee_nonneg_check"
  CHECK (COALESCE("application_fee_minor", 0) >= 0);

-- ─── Date-range invariants ────────────────────────────────────────────

-- AI-22 — date-range invariants. Use IS NULL guards so the constraints
-- accept open-ended ranges where the schema permits NULL on one side.
ALTER TABLE "competitions"
  DROP CONSTRAINT IF EXISTS "competitions_date_range_check";
ALTER TABLE "competitions"
  ADD CONSTRAINT "competitions_date_range_check"
  CHECK ("end_date" IS NULL OR "start_date" <= "end_date");

ALTER TABLE "livery_invoices"
  DROP CONSTRAINT IF EXISTS "livery_invoices_period_range_check";
ALTER TABLE "livery_invoices"
  ADD CONSTRAINT "livery_invoices_period_range_check"
  CHECK ("period_start" <= "period_end");

ALTER TABLE "horse_medications"
  DROP CONSTRAINT IF EXISTS "horse_medications_date_range_check";
ALTER TABLE "horse_medications"
  ADD CONSTRAINT "horse_medications_date_range_check"
  CHECK ("end_date" IS NULL OR "start_date" <= "end_date");

-- ─── Platform fee bounds ──────────────────────────────────────────────

-- AI-22 — clubs.platform_fee_percent must be in [0, 100].
ALTER TABLE "clubs"
  DROP CONSTRAINT IF EXISTS "clubs_platform_fee_percent_bounds_check";
ALTER TABLE "clubs"
  ADD CONSTRAINT "clubs_platform_fee_percent_bounds_check"
  CHECK (
    "platform_fee_percent" >= 0
    AND "platform_fee_percent" <= 100
  );

-- ─── Webhook attempt counter monotonicity ─────────────────────────────

ALTER TABLE "webhook_events"
  DROP CONSTRAINT IF EXISTS "webhook_events_attempt_count_nonneg_check";
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_attempt_count_nonneg_check"
  CHECK ("attempt_count" >= 0);

-- ─── Platform fee percent default correction ──────────────────────────
-- AI-32k — lower the column default to 0.9 (the documented pricing tier).
-- Existing rows are NOT auto-updated; an admin must explicitly migrate
-- clubs that signed up under the legacy 3.5 default to avoid silently
-- changing what merchants are charged.
ALTER TABLE "clubs" ALTER COLUMN "platform_fee_percent" SET DEFAULT '0.9';
