-- 2026-05-04 — drop the dead Stripe Connect platform-fee columns.
--
-- Background. Cavaliq pivoted from a Stripe Connect platform model
-- (Cavaliq is a registered platform; clubs OAuth in; we capture a 0.9%
-- application_fee_amount on every PI) to a direct-keys model (each
-- club pastes their own Stripe sk/pk into our settings form; the full
-- charge lands in their balance; Cavaliq revenue comes from the
-- subscription tiers, not per-booking fees).
--
-- The Connect path was never live in production (no STRIPE_CLIENT_ID
-- was ever set as a wrangler secret), so these columns hold no data.
-- Each DROP is `IF EXISTS` so the migration is idempotent and safe to
-- re-run.
--
-- Columns being dropped:
--   * bookings.application_fee_minor — added by 0021, snapshotted the
--     application_fee_amount at first PI create. Read by the cancel-
--     refund path to compute proportional fee reversal. Both call sites
--     are gone.
--   * clubs.platform_fee_percent — fed the snapshot calculation. The
--     CHECK constraint added in 0025 (`clubs_platform_fee_percent_bounds_check`)
--     drops with the column.
--   * payments.platform_fee — added in 0000, never populated by any code
--     path the audit could find. Truly orphaned.

-- bookings.application_fee_minor — only column add was in 0021, no other
-- references in indexes or constraints.
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "application_fee_minor";

-- clubs.platform_fee_percent — drop the bounds CHECK first so the column
-- DROP doesn't fail with a dangling constraint. Postgres usually drops
-- constraints with the column, but explicit is safer.
ALTER TABLE "clubs"
  DROP CONSTRAINT IF EXISTS "clubs_platform_fee_percent_bounds_check";
ALTER TABLE "clubs" DROP COLUMN IF EXISTS "platform_fee_percent";

-- payments.platform_fee — no constraints or indexes attached.
ALTER TABLE "payments" DROP COLUMN IF EXISTS "platform_fee";
