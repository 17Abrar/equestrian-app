-- 2026-05-05 audit pass-2 closeout — HIGH-3 finding closure.
--
-- Verifier migration: pre-existing `rider_profiles.medical_notes` rows
-- shipped as plaintext (the app started encrypting on write only as of
-- the 2026-05-05 first-pass closeout). This migration MUST be preceded
-- by `node scripts/backfill-rider-medical-notes.mjs` against the same
-- database, which encrypts every plaintext row in place using the
-- application's `encryptField` envelope (`v1:` + base64(IV || tag || ct))
-- and the same `ENCRYPTION_KEY` the runtime uses.
--
-- This file is a verifier — it raises an exception if any plaintext
-- row remains, so the deploy can't proceed without the backfill having
-- been run. Idempotent: once every row carries the `v1:` prefix, the
-- migration applies cleanly and stays applied.

DO $$
DECLARE
  v_plaintext_count integer;
BEGIN
  SELECT COUNT(*) INTO v_plaintext_count
  FROM rider_profiles
  WHERE medical_notes IS NOT NULL
    AND medical_notes <> ''
    AND medical_notes NOT LIKE 'v1:%';

  IF v_plaintext_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0034 aborted: % rider_profiles row(s) hold plaintext medical_notes. Run scripts/backfill-rider-medical-notes.mjs against this database (with ENCRYPTION_KEY set) before re-running migrations.',
      v_plaintext_count;
  END IF;
END $$;
