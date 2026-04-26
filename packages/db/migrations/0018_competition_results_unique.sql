-- Audit 2026-04-26 — uniqueness on competition_results.entry_id.
--
-- Background. Each competition_entry should have at most one result row.
-- The schema had `idx_competition_results_entry` but no UNIQUE constraint,
-- so two judges submitting results for the same entry concurrently both
-- passed the route-level entry-exists check and both INSERTed. The
-- leaderboard query then ranked the same rider twice and there was no
-- audit trail of which row was canonical.
--
-- The application-layer fix (route maps 23505 -> 409 DUPLICATE_RESULT)
-- ships in the same audit pass. This migration moves the invariant into
-- the schema so a future regression cannot reintroduce duplicates.
--
-- Steps:
--   1. Collapse any pre-existing duplicates: keep the earliest row per
--      entry (created_at MIN), delete the rest. Production has not been
--      observed in this state, but a constraint-adding migration must be
--      safe against any state.
--   2. Add UNIQUE (entry_id) on competition_results, idempotently.

-- Step 1 — collapse duplicates.

DELETE FROM "competition_results" cr
USING "competition_results" keep
WHERE cr.entry_id = keep.entry_id
  AND keep.created_at < cr.created_at;

-- Tie-break for rows with identical created_at: keep the one with the
-- lowest id (uuid sort is stable).

DELETE FROM "competition_results" cr
USING "competition_results" keep
WHERE cr.entry_id = keep.entry_id
  AND keep.created_at = cr.created_at
  AND keep.id < cr.id;

-- Step 2 — add the unique constraint, guarded for re-runs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competition_results_entry_unique'
  ) THEN
    ALTER TABLE "competition_results"
      ADD CONSTRAINT "competition_results_entry_unique" UNIQUE ("entry_id");
  END IF;
END $$;
