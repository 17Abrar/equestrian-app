-- 2026-05-08 audit round 6 — F-6 closure.
--
-- Partial UNIQUE constraint on (provider, external_account_id) for
-- N-Genius rows. The single-URL receiver
-- (`apps/web/app/api/webhooks/n-genius/route.ts`) looks up the club
-- from `payload.outletId` via `findWebhookConfigByExternalId(outletId,
-- 'n_genius')`. Without this constraint, two clubs sharing an outletId
-- (operator error, schema migration mishap, future N-Genius rebrand
-- collapsing outlet IDs) silently bind webhooks to whichever row
-- Drizzle returns first.
--
-- Stripe and Ziina avoid this surface by URL-binding the clubId
-- (`/api/webhooks/stripe/[clubId]`); N-Genius alone trusts the body.
-- The partial form excludes `disabled` rows so an operator can roll
-- a new outlet binding without first deleting the old one.
--
-- Drizzle has no partial-unique-index builder, so this lives at the
-- SQL layer only. The `payment_accounts` schema in
-- `packages/db/src/schema/payment-accounts.ts` (or wherever it lives)
-- gets a comment block documenting the SQL-only artifact, mirroring
-- the F-9 / `idx_bookings_provider_payment` pattern from
-- `bookings.ts`.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_accounts_n_genius_outlet_unique"
  ON "club_payment_accounts" ("provider", "external_account_id")
  WHERE provider = 'n_genius'
    AND status <> 'disabled'
    AND external_account_id IS NOT NULL;
