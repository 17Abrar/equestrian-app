-- Audit J-1 — distinguish "admin kicked this member" from "member left
-- voluntarily" so `joinClubInstantly` can refuse rejoin in the former
-- case while still allowing rejoin in the latter (which is the
-- documented contract exercised by signup-join.test.ts:101).
--
-- Nullable timestamp; the staff DELETE handler stamps it on admin-driven
-- deactivation. A future "leave club" / self-removal flow leaves the
-- column null so the rider can rejoin freely. Existing inactive rows
-- are NOT backfilled — they're treated as voluntary leaves so the
-- launch tenant's pre-J-1 deactivations don't suddenly become
-- unrecoverable.

DO $$ BEGIN
  ALTER TABLE "club_members"
    ADD COLUMN "deactivated_by_admin_at" timestamp with time zone;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Lookup index for the join route's check (filters to is_active=false
-- AND deactivated_by_admin_at IS NOT NULL). Partial index keeps it
-- small — only kicked rows are stored. Active members (the bulk of
-- the table) skip the index entirely.
CREATE INDEX IF NOT EXISTS "idx_club_members_admin_deactivated"
  ON "club_members" ("club_id", "clerk_user_id")
  WHERE "deactivated_by_admin_at" IS NOT NULL;
