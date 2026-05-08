-- 2026-05-08 audit round 6 — schema drift cluster.
--
-- Bundles four mechanical schema additions, all with idempotency guards
-- so re-running against an already-migrated database is a no-op.
--
-- F-9  bookings_guest_contact_required_check — already shipped via
--      migration 0015 as SQL-only; no-op DB-side here, the TS schema
--      now mirrors it (`packages/db/src/schema/bookings.ts`).
--
-- F-26 community_votes_target_xor_check — exactly one of (post_id,
--      comment_id) must be set. Without it, NULL/NULL passes both
--      unique constraints (silently double-counts), and a row with
--      both set skews counts on both targets.
--
-- F-28 lesson_types_riders_minmax_check — `min_riders <= max_riders`.
--      A misclick produces a lesson type that never matches any slot.
--
-- F-30 bookings_amount_required_when_confirmed_check — `amount` must
--      be NOT NULL unless the booking is in a no-charge status
--      (`cancelled` / `pending` / `no_show`). Defends against a
--      NULL `amount` on confirmed/completed rows where it would
--      silently allow refundedAmountMinor=0 / NaN no-show fee.
--      Verified historical data first (DO block at top).
--
-- F-60 rider_achievements.updated_at — `notified` mutates, so per
--      CLAUDE.md every mutable row carries `updated_at`. Backfill
--      from `unlocked_at`.

-- ─── F-30 historical-data verifier ────────────────────────────────────
-- Refuses to add the constraint if any current row would violate it.
-- The recommendation in the audit is "verify historical data first"
-- — this DO block enforces it. If a deploy hits this and aborts, the
-- operator must inspect the rows and decide whether to backfill the
-- amount or transition them to a no-charge status before re-running.
DO $$
DECLARE
  v_violations integer;
BEGIN
  SELECT COUNT(*) INTO v_violations
  FROM bookings
  WHERE amount IS NULL
    AND status NOT IN ('cancelled','pending','no_show');

  IF v_violations > 0 THEN
    RAISE EXCEPTION
      'Migration 0049 aborted: % bookings row(s) have NULL amount with status NOT IN (cancelled,pending,no_show). Inspect and backfill before re-running.',
      v_violations;
  END IF;
END $$;

-- ─── F-26: community_votes XOR ────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_votes_target_xor_check'
  ) THEN
    ALTER TABLE "community_votes"
      ADD CONSTRAINT "community_votes_target_xor_check"
      CHECK ((post_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int = 1);
  END IF;
END $$;

-- ─── F-28: lesson_types min<=max ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lesson_types_riders_minmax_check'
  ) THEN
    ALTER TABLE "lesson_types"
      ADD CONSTRAINT "lesson_types_riders_minmax_check"
      CHECK (min_riders <= max_riders);
  END IF;
END $$;

-- ─── F-30: bookings.amount required when confirmed ────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_amount_required_when_confirmed_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_amount_required_when_confirmed_check"
      CHECK (amount IS NOT NULL OR status IN ('cancelled','pending','no_show'));
  END IF;
END $$;

-- ─── F-60: rider_achievements.updated_at ──────────────────────────────
ALTER TABLE "rider_achievements"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

-- Backfill any pre-existing rows so updated_at reflects the original
-- unlock event rather than the migration timestamp. Idempotent — only
-- touches rows where updated_at == created_at (the default-stamped
-- value at column-add time).
UPDATE "rider_achievements"
   SET updated_at = unlocked_at
 WHERE updated_at = created_at
   AND unlocked_at <> created_at;
