-- Audit M-6, M-8, M-9, M-4 — misc indexes + CHECK constraints found
-- in the May 2026 audit. Each section is independent; failure of one
-- doesn't roll back the others (DO blocks where appropriate).

-- ─── M-6: horse_pairing_history index on (club_id, rider_member_id) ──
-- The matcher's enumeration query filters on both, but the only
-- existing index is on (horse_id, rider_member_id) so high-volume
-- pairings (every booking writes a row) cause a seq-scan-then-filter.

CREATE INDEX IF NOT EXISTS "idx_pairing_club_rider"
  ON "horse_pairing_history" ("club_id", "rider_member_id");

-- ─── M-9: club_payment_accounts partial unique on is_active ─────────
-- The "at most one active provider per club" invariant is enforced in
-- application code (setActiveProvider deactivates others under tx),
-- but a future bypass path could leave 2 active. Partial unique
-- closes the loophole at the schema level.

CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_accounts_one_active_per_club"
  ON "club_payment_accounts" ("club_id")
  WHERE "is_active" = true;

-- ─── M-8: community_topics CHECK on default-vs-club ─────────────────
-- A "default" topic must be global (club_id IS NULL). A club-scoped
-- topic must NOT be default. Without this, the schema permits the
-- nonsense `(is_default=true, club_id=<some-uuid>)` row.

DO $$ BEGIN
  ALTER TABLE "community_topics"
    ADD CONSTRAINT "topics_default_xor_club"
    CHECK ("is_default" = ("club_id" IS NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── M-4: bookings.discount_amount NOT NULL ─────────────────────────
-- Schema declared a default of 0 but allowed NULL. A future bug
-- writing NULL would have any SUM(discount_amount) silently swallow
-- those rows. Tighten to NOT NULL with backfill.

UPDATE "bookings" SET "discount_amount" = 0 WHERE "discount_amount" IS NULL;
ALTER TABLE "bookings" ALTER COLUMN "discount_amount" SET NOT NULL;
