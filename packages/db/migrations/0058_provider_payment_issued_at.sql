-- Audit I1 (2026-05-18 audit pass). The N-Genius webhook defense-in-
-- depth check `wasProviderPaymentIssuedRecently` previously keyed off
-- `bookings.created_at` / `livery_invoices.created_at` to decide
-- whether a `provider_payment_id` arriving in a webhook event had
-- been minted "recently". That's the wrong axis: a booking can be
-- created at hour 0, the rider can save the pay-link tab, and click
-- Pay at hour 25 — `created_at` is now 25h old but the
-- `provider_payment_id` itself was minted seconds ago. Under a 24h
-- gate the legitimate event was rejected. PR #118 made this worse:
-- it allowed a route-driven retry to replace an abandoned
-- `provider_payment_id`, so the row's pay-link ID can be hours
-- younger than `created_at` even on first-time payment.
--
-- Add a `provider_payment_issued_at` timestamp on both
-- `bookings` and `livery_invoices`. Writers
-- (`setBookingPaymentRef`, `setInvoiceProviderRef`) stamp it on
-- every providerPaymentId set / replace. The freshness gate then
-- keys on this column instead of `created_at`, restoring tight
-- bounds (24h after pay-link issuance) without rejecting legitimate
-- delayed completions.
--
-- Backfill existing rows from `created_at`: every prior row's
-- providerPaymentId — if set — was minted at or near row creation,
-- so created_at is the closest available proxy. After the backfill
-- the column is non-null on every existing row that ever had a
-- providerPaymentId set, and continues to track issuance for every
-- subsequent write.
--
-- The column is nullable for rows that never go through a payment
-- flow (cash bookings, draft invoices) — readers that compare it
-- to "recently" treat NULL as "not issued in window" via the gte()
-- predicate, which is the correct posture.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS provider_payment_issued_at timestamptz;
--> statement-breakpoint

ALTER TABLE livery_invoices
  ADD COLUMN IF NOT EXISTS provider_payment_issued_at timestamptz;
--> statement-breakpoint

-- Backfill: any row with a non-null provider_payment_id is treated
-- as having issued the pay-link at `updated_at` time. NULL stays NULL
-- for rows that never went through payment.
--
-- Why updated_at, not created_at: PR #118 allows a route-driven
-- retry to replace an abandoned providerPaymentId hours/days after
-- row creation, and the livery cron may attach a pay link on a
-- later reminder pass. For these cases `created_at` is too old —
-- the freshly minted reference would be marked stale and the
-- freshness gate would 401 the legitimate webhook. `updated_at`
-- bumps on every providerPaymentId set/replace (and on other
-- writes too), so it's a strict upper bound on actual mint time
-- and the closest proxy available pre-migration. For rows whose
-- providerPaymentId was set at creation and never replaced, the
-- two timestamps are typically within milliseconds.
UPDATE bookings
   SET provider_payment_issued_at = updated_at
 WHERE provider_payment_id IS NOT NULL
   AND provider_payment_issued_at IS NULL;
--> statement-breakpoint

UPDATE livery_invoices
   SET provider_payment_issued_at = updated_at
 WHERE provider_payment_id IS NOT NULL
   AND provider_payment_issued_at IS NULL;
--> statement-breakpoint

-- Supporting index for the wasProviderPaymentIssuedRecently lookups.
-- The existing club_id + provider_payment_id filter already covers
-- most selectivity; this composite index adds the timestamp so the
-- 24h window range scan stays index-only.
CREATE INDEX IF NOT EXISTS "idx_bookings_provider_payment_issued_at"
  ON "bookings" ("club_id", "payment_provider", "provider_payment_id", "provider_payment_issued_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_livery_invoices_provider_payment_issued_at"
  ON "livery_invoices" ("club_id", "payment_provider", "provider_payment_id", "provider_payment_issued_at");
