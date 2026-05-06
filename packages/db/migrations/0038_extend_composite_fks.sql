-- 2026-05-06 audit (third pass) — extend composite (id, club_id) FKs to the
-- five tables migration 0017 + 0019 missed.
--
-- Background. Migration 0017 added composite (horse_id, club_id) ->
-- horses(id, club_id) FKs to the six horse-health sub-tables. Migration
-- 0019 added composite (member_id, club_id) -> club_members(id, club_id)
-- FKs to selected member-referencing tables. The third-pass audit
-- identified five tables that fit the same pattern but weren't included:
--
--   - groom_tasks.horse_id
--   - livery_invoices.horse_id      (NOT NULL — keep ON DELETE CASCADE)
--   - livery_invoices.owner_member_id
--   - competition_entries.horse_id  (NULLABLE — ON DELETE SET NULL)
--   - expenses.horse_id             (NULLABLE — ON DELETE SET NULL)
--   - bookings.rider_member_id
--
-- Application-layer scoping (route-level `getHorseById(ctx.clubId, ...)`
-- and `getMemberById(ctx.clubId, ...)` prechecks) currently holds the
-- invariant. This migration moves the same invariant into the schema —
-- defence in depth so a future handler that omits the precheck cannot
-- poison foreign-tenant data.
--
-- Pre-clean (DELETE rows with mismatched club_id) mirrors 0017's
-- approach. Production has zero such rows today; the cleanup is a
-- safety net for any database that diverged.

-- Step 1 — orphan cleanup --------------------------------------------

DELETE FROM "groom_tasks" t USING "horses" h
WHERE h.id = t.horse_id AND h.club_id <> t.club_id;

DELETE FROM "livery_invoices" i USING "horses" h
WHERE h.id = i.horse_id AND h.club_id <> i.club_id;

DELETE FROM "livery_invoices" i USING "club_members" m
WHERE m.id = i.owner_member_id AND m.club_id <> i.club_id;

DELETE FROM "competition_entries" e USING "horses" h
WHERE e.horse_id IS NOT NULL AND h.id = e.horse_id AND h.club_id <> e.club_id;

DELETE FROM "expenses" e USING "horses" h
WHERE e.horse_id IS NOT NULL AND h.id = e.horse_id AND h.club_id <> e.club_id;

DELETE FROM "bookings" b USING "club_members" m
WHERE m.id = b.rider_member_id AND m.club_id <> b.club_id;

-- Step 2 — drop existing single-column FKs ---------------------------
-- Names sourced from `pg_constraint` against the live DB. `IF EXISTS`
-- so the migration is idempotent and survives a re-run on a partially-
-- migrated environment.

ALTER TABLE "groom_tasks"
  DROP CONSTRAINT IF EXISTS "groom_tasks_horse_id_horses_id_fk";

ALTER TABLE "livery_invoices"
  DROP CONSTRAINT IF EXISTS "livery_invoices_horse_id_fkey";

ALTER TABLE "livery_invoices"
  DROP CONSTRAINT IF EXISTS "livery_invoices_owner_member_id_fkey";

ALTER TABLE "competition_entries"
  DROP CONSTRAINT IF EXISTS "competition_entries_horse_id_horses_id_fk";

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_horse_id_horses_id_fk";

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_rider_member_id_club_members_id_fk";

-- Step 3 — composite FKs ---------------------------------------------
-- Wrapped in `DO $$ ... $$` blocks so each constraint is only created
-- if missing, mirroring 0017's idempotent shape.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groom_tasks_horse_club_fk') THEN
    ALTER TABLE "groom_tasks"
      ADD CONSTRAINT "groom_tasks_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id")
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'livery_invoices_horse_club_fk') THEN
    ALTER TABLE "livery_invoices"
      ADD CONSTRAINT "livery_invoices_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id")
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'livery_invoices_owner_member_club_fk') THEN
    ALTER TABLE "livery_invoices"
      ADD CONSTRAINT "livery_invoices_owner_member_club_fk"
      FOREIGN KEY ("owner_member_id", "club_id")
      REFERENCES "club_members"("id", "club_id");
    -- ON DELETE NO ACTION: invoices are financial records that should
    -- outlive a member departure; finance reports query historical
    -- rows by owner_member_id even after the member row goes away.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_horse_club_fk') THEN
    ALTER TABLE "competition_entries"
      ADD CONSTRAINT "competition_entries_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id")
      ON DELETE SET NULL;
    -- horse_id is nullable on this table (an entry can be made before
    -- the horse is finalised); SET NULL preserves the entry record
    -- when a horse is later deleted.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_horse_club_fk') THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id")
      ON DELETE SET NULL;
    -- horse_id is nullable; SET NULL keeps the expense as an unattributed
    -- club-level cost when the horse it referenced is deleted.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_rider_member_club_fk') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_rider_member_club_fk"
      FOREIGN KEY ("rider_member_id", "club_id")
      REFERENCES "club_members"("id", "club_id");
    -- ON DELETE NO ACTION: bookings are historical financial records.
    -- A member deletion would have to cascade through (or detach)
    -- bookings explicitly via application-layer logic.
  END IF;
END $$;
