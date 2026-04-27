-- Audit 2026-04-26 — schema-level enforcement of (member_id, club_id) binding
-- on tables that join `club_members` for display purposes.
--
-- Background. `rider_profiles`, `payments`, and `invoices` each have a
-- single-column FK on `member_id -> club_members(id)`. The Drizzle queries
-- behind the riders / payments / invoices list pages JOIN `club_members` to
-- project `display_name` / `email` / `phone` next to the row. The FK validates
-- that the member exists, but does not enforce that the member belongs to the
-- same club as the parent row. A row inserted with mismatched
-- (member_id, club_id) — possible if any code path passes the wrong pair —
-- would surface a foreign tenant's name in the join.
--
-- The application-layer fix (binding `clubMembers.club_id` on the join itself)
-- shipped in the same audit pass. This migration moves the same invariant
-- into the schema: a composite FK (member_id, club_id) -> club_members(id, club_id),
-- so the DB itself rejects the mismatched insert. Same pattern as migration
-- 0017 used for horse sub-resources.
--
-- Steps:
--   1. Delete orphan rows (sub.club_id <> member.club_id). Production has not
--      been observed in this state, but a constraint-adding migration must be
--      safe against any state.
--   2. Add UNIQUE (id, club_id) on club_members — required as the composite
--      FK target. id is already PK so this is tautologically unique; Postgres
--      requires the explicit constraint anyway.
--   3. For each table: drop the single-column member_id FK, add the composite
--      (member_id, club_id) FK with the same ON DELETE behaviour. The original
--      FK names are the Drizzle-generated ones from migration 0000.

-- Step 1 — orphan cleanup. Each DELETE removes rows whose stored club_id
-- disagrees with the member's actual club_id. The composite FK in step 3
-- would otherwise reject the migration.

DELETE FROM "rider_profiles" rp
USING "club_members" m
WHERE m.id = rp.member_id AND m.club_id <> rp.club_id;

DELETE FROM "payments" p
USING "club_members" m
WHERE m.id = p.member_id AND m.club_id <> p.club_id;

DELETE FROM "invoices" i
USING "club_members" m
WHERE m.id = i.member_id AND m.club_id <> i.club_id;

-- Step 2 — composite unique on club_members. Required so the column-pair can
-- be a valid FK target.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'club_members_id_club_unique'
  ) THEN
    ALTER TABLE "club_members"
      ADD CONSTRAINT "club_members_id_club_unique" UNIQUE ("id", "club_id");
  END IF;
END $$;

-- Step 3 — swap each single-column FK for a composite FK. ON DELETE behaviour
-- mirrors the original constraints from migration 0000:
--   rider_profiles.member_id -> CASCADE
--   payments.member_id       -> NO ACTION
--   invoices.member_id       -> NO ACTION

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rider_profiles_member_id_club_members_id_fk'
  ) THEN
    ALTER TABLE "rider_profiles"
      DROP CONSTRAINT "rider_profiles_member_id_club_members_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rider_profiles_member_club_fk'
  ) THEN
    ALTER TABLE "rider_profiles"
      ADD CONSTRAINT "rider_profiles_member_club_fk"
      FOREIGN KEY ("member_id", "club_id")
      REFERENCES "club_members"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_member_id_club_members_id_fk'
  ) THEN
    ALTER TABLE "payments"
      DROP CONSTRAINT "payments_member_id_club_members_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_member_club_fk'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_member_club_fk"
      FOREIGN KEY ("member_id", "club_id")
      REFERENCES "club_members"("id", "club_id") ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_member_id_club_members_id_fk'
  ) THEN
    ALTER TABLE "invoices"
      DROP CONSTRAINT "invoices_member_id_club_members_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_member_club_fk'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_member_club_fk"
      FOREIGN KEY ("member_id", "club_id")
      REFERENCES "club_members"("id", "club_id") ON DELETE NO ACTION;
  END IF;
END $$;
