-- 0060_audit_pass_7_payment_provider_checks.sql
--
-- Audit pass-7 (2026-05-24/25 MED-2): the pass-7 DB-audit agent flagged
-- that `livery_invoices.payment_provider` and
-- `platform_subscription_invoices.payment_provider` are both `varchar(50)`
-- while `bookings.payment_provider` is the strict `payment_provider`
-- enum. A typo like `'stipe'` slips past the column type and breaks the
-- downstream webhook routing path
-- (`findWebhookConfigByExternalId(_, 'stipe')` returns null) silently.
--
-- The agent recommended migrating both columns to the enum. That doesn't
-- work for `platform_subscription_invoices` — the platform-billing flow
-- writes `'ziina_platform'` as a distinct provider name (see
-- `apps/web/app/api/webhooks/ziina-platform/route.ts:40` and
-- `apps/web/app/api/cron/platform-billing/route.ts:173`), which is
-- intentionally NOT a member of the `payment_provider` enum
-- (`['stripe', 'n_genius', 'ziina']`). Forcing the enum would drop those
-- rows on conversion.
--
-- The lower-risk equivalent is a CHECK constraint per column whitelisting
-- the values actually used. Same typo protection, no type change, no
-- prod-data conversion risk. `NOT VALID + VALIDATE CONSTRAINT` keeps the
-- ALTER non-blocking (the lock is upgraded only for the validate scan,
-- which is fast on JSR's row counts).
--
-- Backfill check: both columns currently hold either NULL (invoice has
-- no payment captured yet) or one of the documented strings. The
-- application code paths that write these columns are statically typed
-- (`packages/db/src/queries/livery-invoices.ts:182` declares
-- `paymentProvider?: string` but the call sites pass
-- `payIntent?.provider` which is the `PaymentProviderName` union), so the
-- constraint should validate clean. The transaction below would roll
-- back any pre-existing typo, which is the desired diagnostic.

-- No BEGIN/COMMIT — `migrate-neon.mjs` runs each statement in its own
-- transaction (see `packages/db/migrations/README.md` "Authoritative
-- runner"), so wrapping would be a no-op in prod. PGlite's test harness
-- runs the whole file as an implicit transaction and would warn on the
-- nested BEGIN. Each ALTER below is independently safe.

ALTER TABLE livery_invoices
  ADD CONSTRAINT livery_invoices_payment_provider_check
  CHECK (payment_provider IS NULL OR payment_provider IN ('stripe', 'n_genius', 'ziina'))
  NOT VALID;

ALTER TABLE livery_invoices
  VALIDATE CONSTRAINT livery_invoices_payment_provider_check;

ALTER TABLE platform_subscription_invoices
  ADD CONSTRAINT platform_subscription_invoices_payment_provider_check
  CHECK (payment_provider IS NULL OR payment_provider IN ('ziina_platform'))
  NOT VALID;

ALTER TABLE platform_subscription_invoices
  VALIDATE CONSTRAINT platform_subscription_invoices_payment_provider_check;
