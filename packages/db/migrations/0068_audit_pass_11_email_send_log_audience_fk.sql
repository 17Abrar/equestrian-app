-- 0068_audit_pass_11_email_send_log_audience_fk.sql
--
-- Audit pass-11 (2026-06-06), finding db-migrations-4.
--
-- email_send_log.audience_id (migration 0066) was a single-column FK to
-- audiences(id) that does NOT bind the referenced audience to the row's
-- club_id. Its sibling sender_member_id got the composite (sender_member_id,
-- club_id) -> club_members(id, club_id) FK; audience_id did not, so a row in
-- club A could store an audience_id belonging to club B. Every tenant child
-- relation in this schema uses a composite (child, club_id) FK precisely to
-- make cross-tenant planting impossible at the DB layer.
--
-- This promotes audience_id to the composite convention:
--   1. Add the missing (id, club_id) UNIQUE on audiences (the parent target —
--      id is already PK so this is trivially satisfiable).
--   2. Drop the single-column FK (Postgres default name <table>_<col>_fkey).
--   3. Add the composite (audience_id, club_id) -> audiences(id, club_id) FK.
--
-- ON DELETE NO ACTION (not SET NULL): email_send_log.club_id is NOT NULL, so a
-- composite SET NULL would try to null club_id and abort. `deleteAudience`
-- clears email_send_log.audience_id in the same transaction before deleting the
-- audience, preserving the prior "log kept, audience ref cleared" behavior.
--
-- Idempotent: ADD CONSTRAINT throws 42710 if it already exists (swallowed by
-- the migrate-neon runner); DROP ... IF EXISTS is a no-op when already dropped.

ALTER TABLE "audiences"
  ADD CONSTRAINT "audiences_id_club_unique" UNIQUE ("id", "club_id");
--> statement-breakpoint
ALTER TABLE "email_send_log"
  DROP CONSTRAINT IF EXISTS "email_send_log_audience_id_fkey";
--> statement-breakpoint
ALTER TABLE "email_send_log"
  ADD CONSTRAINT "email_send_log_audience_club_fk"
  FOREIGN KEY ("audience_id", "club_id")
  REFERENCES "audiences"("id", "club_id") ON DELETE NO ACTION;
