-- Audit 2026-04-26 — schema-level enforcement of (horse_id, club_id) binding
-- on horse sub-resources (health, medications, medication-logs, feeding,
-- exercise, documents).
--
-- Background. Each sub-table had a single-column FK on horse_id -> horses(id).
-- A POST handler taking clubId from the auth context and horseId from the
-- URL could insert a row with mismatched (club_id, horse_id) — both single-
-- column FKs validated independently, but the row pointed at a horse in a
-- different club. Reads filtered on both columns so cross-tenant *exfiltration*
-- was not enabled, but cross-tenant data integrity was broken.
--
-- The application-layer fix (route-level getHorseById precheck) shipped in
-- the same audit pass. This migration moves the same invariant into the
-- schema: a composite FK (horse_id, club_id) -> horses(id, club_id), so
-- the DB itself rejects the mismatched insert. Defence in depth — a future
-- handler that omits the precheck still cannot poison a foreign tenant's
-- data.
--
-- Steps:
--   1. Delete orphan rows (sub.club_id <> horse.club_id). Production has
--      not been observed in this state, but a constraint-adding migration
--      must be safe against any state.
--   2. Add UNIQUE (id, club_id) on horses — required as the composite FK
--      target. id is already PK so this is tautologically unique; Postgres
--      requires the explicit constraint anyway.
--   3. For each sub-table: drop the single-column horse_id FK, add the
--      composite (horse_id, club_id) FK with the same ON DELETE CASCADE
--      behaviour. The original FK names are the Drizzle-generated ones
--      from migration 0001.

-- Step 1 — orphan cleanup. Each DELETE removes rows whose stored club_id
-- disagrees with the horse's actual club_id. The composite FK in step 3
-- would otherwise reject the migration.

DELETE FROM "horse_health_records" hr
USING "horses" h
WHERE h.id = hr.horse_id AND h.club_id <> hr.club_id;

DELETE FROM "horse_medications" m
USING "horses" h
WHERE h.id = m.horse_id AND h.club_id <> m.club_id;

DELETE FROM "horse_medication_logs" l
USING "horses" h
WHERE h.id = l.horse_id AND h.club_id <> l.club_id;

DELETE FROM "horse_feeding_plans" f
USING "horses" h
WHERE h.id = f.horse_id AND h.club_id <> f.club_id;

DELETE FROM "horse_exercise_schedules" e
USING "horses" h
WHERE h.id = e.horse_id AND h.club_id <> e.club_id;

DELETE FROM "horse_documents" d
USING "horses" h
WHERE h.id = d.horse_id AND h.club_id <> d.club_id;

-- Step 2 — composite unique on horses. Required so the column-pair can be
-- a valid FK target.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'horses_id_club_unique'
  ) THEN
    ALTER TABLE "horses"
      ADD CONSTRAINT "horses_id_club_unique" UNIQUE ("id", "club_id");
  END IF;
END $$;

-- Step 3 — swap each single-column FK for a composite FK.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_health_records_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_health_records"
      DROP CONSTRAINT "horse_health_records_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_health_records_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_health_records"
      ADD CONSTRAINT "horse_health_records_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_medications_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_medications"
      DROP CONSTRAINT "horse_medications_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_medications_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_medications"
      ADD CONSTRAINT "horse_medications_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_medication_logs_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_medication_logs"
      DROP CONSTRAINT "horse_medication_logs_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_medication_logs_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_medication_logs"
      ADD CONSTRAINT "horse_medication_logs_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_feeding_plans_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_feeding_plans"
      DROP CONSTRAINT "horse_feeding_plans_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_feeding_plans_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_feeding_plans"
      ADD CONSTRAINT "horse_feeding_plans_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_exercise_schedules_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_exercise_schedules"
      DROP CONSTRAINT "horse_exercise_schedules_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_exercise_schedules_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_exercise_schedules"
      ADD CONSTRAINT "horse_exercise_schedules_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_documents_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "horse_documents"
      DROP CONSTRAINT "horse_documents_horse_id_horses_id_fk";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horse_documents_horse_club_fk'
  ) THEN
    ALTER TABLE "horse_documents"
      ADD CONSTRAINT "horse_documents_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id") ON DELETE CASCADE;
  END IF;
END $$;
