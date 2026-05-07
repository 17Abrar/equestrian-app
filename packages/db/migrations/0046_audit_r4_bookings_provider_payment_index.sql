-- 2026-05-07 audit (round 4). Closes F-3.
--
-- `bookings.provider_payment_id` is the webhook lookup key — every
-- payment webhook (Stripe / N-Genius / Ziina) hits
-- `findBookingByProviderPaymentId(provider, providerPaymentId)`. The
-- legacy `idx_bookings_stripe` was dropped in migration 0035 when
-- `stripe_payment_intent_id` was retired, but no replacement on the
-- new generic `provider_payment_id` column was created.
--
-- Sister tables already have the parallel index (`idx_payments_stripe`,
-- `idx_livery_invoices_provider_payment`,
-- `idx_platform_invoices_provider_payment`).
--
-- Partial index keeps size proportional to paid bookings — a club with
-- 10k bookings of which 800 have a `provider_payment_id` only pays
-- index storage for the 800.

CREATE INDEX IF NOT EXISTS "idx_bookings_provider_payment"
  ON "bookings"(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
