-- Audit B-3: snapshot the Stripe Connect application fee on first
-- payment-intent creation so a later change to `clubs.platform_fee_percent`
-- doesn't make finance reports diverge from what Stripe captured.
-- Nullable: null means "not yet set" (booking hasn't reached the payment
-- step) or non-Stripe provider.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "application_fee_minor" integer;
