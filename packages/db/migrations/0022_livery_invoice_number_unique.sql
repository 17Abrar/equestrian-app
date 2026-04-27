-- Audit G-4: invoice numbers must be unique per club. The cron generated
-- numbers from `count(*) + 1` outside any transaction, so two concurrent
-- runs (Cloudflare retry + manual trigger) could mint the same number for
-- different horses. The (horse_id, period_start) constraint stopped same-
-- horse same-period dups but not cross-horse number collisions, breaking
-- audit reconciliation by invoice_number.
--
-- The unique index lets the cron's retry loop (createLiveryInvoiceWith
-- GeneratedNumber) catch the 23505 from a concurrent insert and try again
-- with a fresh number rather than silently producing a dup.

CREATE UNIQUE INDEX IF NOT EXISTS "livery_invoices_club_number_unique"
  ON "livery_invoices" ("club_id", "invoice_number");
