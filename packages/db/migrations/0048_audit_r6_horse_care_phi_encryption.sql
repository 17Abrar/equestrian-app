-- 2026-05-08 audit round 6 — F-2 + F-3 closure.
--
-- Verifier migration: pre-existing rows on `horse_medication_logs.notes`,
-- `horse_medication_logs.skip_reason`, `horse_feeding_plans.notes`, and
-- `horse_exercise_schedules.notes` shipped as plaintext PHI. As of this
-- round the application encrypts these columns on write using the same
-- AES-256-GCM envelope the rest of the medical schema uses (`v1:` +
-- base64(IV || tag || ct)). This migration MUST be preceded by:
--
--     node scripts/backfill-horse-care-phi.mjs
--
-- run against the same database with the same `ENCRYPTION_KEY` the runtime
-- uses. The script encrypts every plaintext row in place; this file is the
-- verifier — it raises an exception if any plaintext row remains, so the
-- deploy can't proceed without the backfill having been run. Idempotent:
-- once every row carries the `v1:` prefix, the migration applies cleanly
-- and stays applied. Mirrors the pattern from migration 0034 / round 4
-- F-3 closeout (`rider_profiles.medical_notes`).

DO $$
DECLARE
  v_med_logs_notes integer;
  v_med_logs_skip integer;
  v_feeding_notes integer;
  v_exercise_notes integer;
  v_total integer;
BEGIN
  SELECT COUNT(*) INTO v_med_logs_notes
  FROM horse_medication_logs
  WHERE notes IS NOT NULL
    AND notes <> ''
    AND notes NOT LIKE 'v1:%';

  SELECT COUNT(*) INTO v_med_logs_skip
  FROM horse_medication_logs
  WHERE skip_reason IS NOT NULL
    AND skip_reason <> ''
    AND skip_reason NOT LIKE 'v1:%';

  SELECT COUNT(*) INTO v_feeding_notes
  FROM horse_feeding_plans
  WHERE notes IS NOT NULL
    AND notes <> ''
    AND notes NOT LIKE 'v1:%';

  SELECT COUNT(*) INTO v_exercise_notes
  FROM horse_exercise_schedules
  WHERE notes IS NOT NULL
    AND notes <> ''
    AND notes NOT LIKE 'v1:%';

  v_total := v_med_logs_notes + v_med_logs_skip + v_feeding_notes + v_exercise_notes;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'Migration 0048 aborted: % plaintext PHI row(s) remain (medication_logs.notes=%, medication_logs.skip_reason=%, feeding_plans.notes=%, exercise_schedules.notes=%). Run scripts/backfill-horse-care-phi.mjs against this database (with ENCRYPTION_KEY set) before re-running migrations.',
      v_total, v_med_logs_notes, v_med_logs_skip, v_feeding_notes, v_exercise_notes;
  END IF;
END $$;
