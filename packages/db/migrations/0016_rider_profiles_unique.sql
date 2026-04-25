-- Add a UNIQUE constraint on (club_id, member_id) for rider_profiles.
--
-- Before this constraint, `upsertRiderProfileByMember` ran a SELECT-then-
-- INSERT path: two concurrent first-time saves on the same brand-new
-- account both saw `existing = []` and both INSERT'd, leaving the rider
-- with two profile rows. Subsequent reads returned non-deterministic
-- weight/height — breaking the smart horse matcher.
--
-- Steps:
--   1. Collapse any existing duplicates: keep the most recently updated row
--      and delete the rest. (Production currently has zero observed dupes,
--      but this guards against corrupt state from the racy upsert path.)
--   2. Create the unique index. `IF NOT EXISTS` keeps the migration
--      idempotent across reruns and bench DBs.
--
-- Once this lands, `upsertRiderProfileByMember` can be simplified to a
-- single INSERT ... ON CONFLICT DO UPDATE (see riders.ts).

-- Step 1 — de-dupe. The window keeps the row with the most recent
-- updated_at; ties broken by created_at, then id.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY club_id, member_id
           ORDER BY updated_at DESC, created_at DESC, id
         ) AS rn
  FROM rider_profiles
)
DELETE FROM rider_profiles
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2 — add the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "rider_profiles_club_member_unique"
  ON "rider_profiles" ("club_id", "member_id");
