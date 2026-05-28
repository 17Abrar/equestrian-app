-- Audit pass 5 (2026-05-10): close two remaining performance gaps from
-- pass 4.
--
-- 1. `findHorsesDueForBilling` filters active livery horses by
--    `livery_start_date <= today` and orders by `livery_start_date DESC`.
--    The partial index keeps the daily cron from sorting the full horses
--    table once clubs have years of archived / non-livery rows.
-- 2. Competition result reads are club-scoped, but `competition_results`
--    only had an entry_id index. Add the tenant index so result lookups
--    do not hash-join through entries at scale.
--
-- Audit L6 (2026-05-18): these were originally CREATE INDEX (locking
-- form). Switching them to CREATE INDEX CONCURRENTLY would be safer
-- for fresh installs, but the PGlite-backed test harness applies each
-- migration file via `client.exec(sql)` which Postgres treats as an
-- implicit transaction — `CONCURRENTLY` errors out inside a tx block.
-- The migration is already applied on JSR (the only beta tenant) so
-- the marginal value of an in-place edit is low; future high-volume
-- index migrations should follow the CONCURRENTLY convention in
-- `packages/db/migrations/README.md` and ship together with the test-
-- harness work needed to apply CONCURRENTLY statements individually.

CREATE INDEX IF NOT EXISTS "idx_horses_livery_billing_due"
  ON "horses" ("livery_start_date" DESC)
  WHERE ownership_status = 'active'
    AND COALESCE(monthly_livery_fee_minor, 0) > 0
    AND deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_competition_results_club"
  ON "competition_results" ("club_id");
