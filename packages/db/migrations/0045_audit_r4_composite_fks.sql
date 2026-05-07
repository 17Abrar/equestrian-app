-- 2026-05-07 audit (round 4). Closes F-1, F-35, F-67.
--
-- Three remaining single-column FKs to tenant-scoped parents:
--   - competition_classes.competition_id  (F-1, the only HIGH in
--     this migration — competitions(id, club_id) UNIQUE was missing
--     entirely, so its children couldn't go composite)
--   - horse_pairing_history.booking_id    (F-35)
--   - arena_schedules.arena_id            (F-67)
--
-- Pre-flight probe (2026-05-07): zero cross-tenant rows on every
-- relation. Pre-clean DELETE blocks omitted.

-- ─── F-1 — UNIQUE on competitions(id, club_id) + composite FK ──────────

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_id_club_unique') THEN
  ALTER TABLE "competitions" ADD CONSTRAINT "competitions_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;

ALTER TABLE "competition_classes"
  DROP CONSTRAINT IF EXISTS "competition_classes_competition_id_competitions_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_classes_competition_club_fk') THEN
  ALTER TABLE "competition_classes" ADD CONSTRAINT "competition_classes_competition_club_fk"
    FOREIGN KEY ("competition_id", "club_id") REFERENCES "competitions"(id, club_id)
    ON DELETE CASCADE;
END IF; END $$;

-- ─── F-35 — horse_pairing_history.booking_id composite ─────────────────

ALTER TABLE "horse_pairing_history"
  DROP CONSTRAINT IF EXISTS "horse_pairing_history_booking_id_bookings_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_pairing_history_booking_club_fk') THEN
  ALTER TABLE "horse_pairing_history" ADD CONSTRAINT "horse_pairing_history_booking_club_fk"
    FOREIGN KEY ("booking_id", "club_id") REFERENCES "bookings"(id, club_id)
    ON DELETE CASCADE;
END IF; END $$;

-- ─── F-67 — arena_schedules.arena_id composite ─────────────────────────
-- Table currently has zero consumers in the codebase, but the schema-
-- completeness invariant says every tenant-scoped FK is composite.

ALTER TABLE "arena_schedules"
  DROP CONSTRAINT IF EXISTS "arena_schedules_arena_id_arenas_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arena_schedules_arena_club_fk') THEN
  ALTER TABLE "arena_schedules" ADD CONSTRAINT "arena_schedules_arena_club_fk"
    FOREIGN KEY ("arena_id", "club_id") REFERENCES "arenas"(id, club_id)
    ON DELETE CASCADE;
END IF; END $$;
