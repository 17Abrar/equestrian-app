-- 0065_email_suppressions_club_id.sql
--
-- Task #21 (2026-05-28): rework `email_suppressions` so manual entries
-- are scoped to the club that added them, while Resend webhook
-- (bounce/complaint) rows stay global.
--
-- Why this needs more than just `ADD COLUMN club_id`:
--   The original 0063 schema used `UNIQUE(email)` — one row per
--   address, globally. That collapsed two distinct concerns:
--     (a) Resend deliverability protection (global — a bounce at one
--         club contaminates the whole sender reputation, so suppression
--         must cover every tenant).
--     (b) Manual operator action (per-club — one club's "this person
--         asked us to stop emailing them" must not silently block other
--         clubs from sending to the same address, nor expose other
--         clubs' lists for tenant-isolation reasons).
--   Codex P1 (2026-05-28): keeping `UNIQUE(email)` means Club A's
--   manual suppression blocks Club B too, and Club B's POST returns
--   `inserted:false` with nothing in their list (cross-tenant signal
--   leak via "you can't suppress this anymore"). It also lets Club A
--   silently override the global webhook row when both exist.
--
-- Resolution: drop the single global UNIQUE and replace with TWO
-- partial unique indexes:
--   • webhook rows: at most one per `email` globally
--     (preserves the deliverability invariant)
--   • manual rows : at most one per `(email, club_id)`
--     (per-club uniqueness, independent across clubs)
--
-- A global webhook row can now coexist with one manual row per club
-- for the same email. `isEmailSuppressed(email)` continues to return
-- true when ANY active row matches, so a global bounce still protects
-- every tenant. A club admin retiring their own manual row never
-- erases the global webhook protection.

ALTER TABLE email_suppressions
  ADD COLUMN club_id uuid REFERENCES clubs(id) ON DELETE CASCADE;

-- ON DELETE CASCADE because `SET NULL` would set club_id to NULL on a
-- manual row, which would then violate the `manual_requires_club`
-- CHECK below — Postgres aborts the cascade and the parent DELETE
-- fails. Manual suppressions die with their owning club; webhook rows
-- (club_id NULL from the start) are unaffected.

ALTER TABLE email_suppressions
  DROP CONSTRAINT email_suppressions_email_unique;

CREATE UNIQUE INDEX email_suppressions_webhook_unique
  ON email_suppressions (email)
  WHERE source = 'resend_webhook';

CREATE UNIQUE INDEX email_suppressions_manual_unique
  ON email_suppressions (email, club_id)
  WHERE source = 'manual';

ALTER TABLE email_suppressions
  ADD CONSTRAINT email_suppressions_manual_requires_club
  CHECK (
    (source = 'manual' AND club_id IS NOT NULL)
    OR
    (source = 'resend_webhook' AND club_id IS NULL)
  );

-- Listing UI hot path: per-club, newest-first, active only.
CREATE INDEX idx_email_suppressions_club
  ON email_suppressions (club_id, created_at DESC)
  WHERE club_id IS NOT NULL AND retired_at IS NULL;
