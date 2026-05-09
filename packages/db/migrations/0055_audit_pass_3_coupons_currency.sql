-- 2026-05-09 audit pass-3 follow-up C — coupon currency.
--
-- The `coupons` table previously had no `currency` column; the
-- discount-math fields (`discount_value`, `max_discount`,
-- `minimum_amount`) are integer minor units that implicitly assumed
-- the coupon and the booking it's applied to share a currency. When
-- a club has lesson types in two currencies, an AED-tuned coupon
-- (`fixed` discount of 20000 = 200 AED) applied to a USD lesson
-- silently treats it as 200 USD off (~4× over-discount).
--
-- This migration:
--   1. Adds `currency varchar(3)` defaulting to 'AED' (matches the
--      column default elsewhere in the schema).
--   2. Backfills every existing row from its parent club's
--      `clubs.currency` so the value is event-truthful, not 'AED'-by-
--      default for clubs that operate in another currency.
--   3. Tightens the column to `NOT NULL` after the backfill.
--
-- New writes are constrained at the application layer:
-- `createCoupon` reads the club's currency and stamps it on the row.
-- `validateCoupon` refuses to apply a coupon whose currency doesn't
-- match the booking's.
--
-- Idempotent — `IF NOT EXISTS` on the column add; the backfill is a
-- no-op once every row is already populated.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'coupons' AND column_name = 'currency'
  ) THEN
    ALTER TABLE coupons ADD COLUMN currency varchar(3);
  END IF;
END $$;

UPDATE coupons
   SET currency = clubs.currency
  FROM clubs
 WHERE coupons.club_id = clubs.id
   AND coupons.currency IS NULL;

ALTER TABLE coupons ALTER COLUMN currency SET DEFAULT 'AED';
ALTER TABLE coupons ALTER COLUMN currency SET NOT NULL;
