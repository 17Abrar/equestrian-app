-- 2026-05-09 audit pass-2 — PHI encryption-at-rest sweep (B-1, B-3).
--
-- Widens varchar(N) → text on PHI columns that are about to be wrapped
-- by `encryptField` / `encryptFields`. The AES-256-GCM envelope
-- (`v1:` + base64(IV || tag || ciphertext)) is ~30-60% longer than
-- plaintext + a 16-byte tag overhead, so a 50-char rider phone number
-- ciphertext doesn't fit in `varchar(50)`. Widening to `text` lets the
-- existing encrypted-fields wiring (mirrors `rider_profiles.medical_
-- notes` from migration 0034) cover these columns.
--
-- Postgres treats `varchar(N) → text` as a no-rewrite metadata change
-- (same internal varlena representation), so no table rewrite happens
-- here — fast on hot tables.
--
-- Idempotent: re-running on an already-text column is a no-op (the
-- catalog's `data_type` matches `text` and the IF blocks short-circuit).
--
-- Companion script: `scripts/backfill-pass-2-phi.mjs` encrypts every
-- existing plaintext row in-place. Recommended sequence:
--   1. Deploy this migration + the new code (encrypt-on-write,
--      decrypt-on-read with plaintext back-compat — `decryptField`
--      passes through values without the `v1:` prefix).
--   2. Run `node scripts/backfill-pass-2-phi.mjs` against prod with
--      `ENCRYPTION_KEY` set. Idempotent; safe to re-run.
--   3. (Future) ship a verifier migration that aborts on any
--      remaining plaintext, once the backfill is confirmed clean.
--      Held back from this PR because the deploy pipeline runs
--      migrations BEFORE deploy — a verifier here would block the
--      deploy of the encrypt-on-write code itself.

DO $$
BEGIN
  -- rider_profiles emergency contacts (B-1)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'rider_profiles'
       AND column_name = 'emergency_contact_name'
       AND data_type = 'character varying'
  ) THEN
    ALTER TABLE rider_profiles
      ALTER COLUMN emergency_contact_name TYPE text,
      ALTER COLUMN emergency_contact_phone TYPE text,
      ALTER COLUMN emergency_contact_relation TYPE text;
  END IF;

  -- horse_medications.prescribed_by (B-3)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'horse_medications'
       AND column_name = 'prescribed_by'
       AND data_type = 'character varying'
  ) THEN
    ALTER TABLE horse_medications
      ALTER COLUMN prescribed_by TYPE text;
  END IF;
END $$;
