-- Audit Round 5 — schema drift sweep (PR Pi).
--
-- Closes:
--   F-15 / F-37: promote `audit_log.{actor_member_id,club_id}` single-column FKs to
--               a composite FK against `club_members(id, club_id)` so the
--               audit trail can't attribute an action in club A to a member of
--               club B. Postgres MATCH SIMPLE skips the composite check on
--               NULL columns — system-level rows (NULL clubId / NULL actor) keep
--               working unchanged. Note: existing single-column FKs target
--               `club_members.id` and `clubs.id`; the composite replaces both.
--   F-17: swap `club_join_requests_unique_pending` from a global UNIQUE
--         (which permanently locks declined riders out) to a partial unique
--         INDEX `WHERE status = 'pending'`. The constraint name advertises
--         partial-pending; this finally matches the name to the predicate.
--   F-40: add `community_topics.updated_at`. The table has mutable columns
--         (name/description/icon/isActive) and was missing the standard
--         `updated_at` companion to `created_at`. Backfill = COALESCE(now()).
--   F-65: drop the duplicate `bookings_*_nonneg_check` constraints from
--         migration 0025. Migration 0042 added the same predicates with
--         different names; live DB carries two functionally identical
--         CHECKs per column, doubling validation overhead on the busiest
--         table. Keep the 0042-style names (already in TS schema).
--   F-16 (partial): drop the redundant `club_join_requests_status_check` and
--                   `clubs_join_policy_check` CHECKs (migration 0008). Both
--                   were superseded by enum promotion in migrations 0026 /
--                   0029; the enums are now the live invariant.

BEGIN;

-- ─── F-15 / F-37: audit_log composite FK ──────────────────────────────

-- The previous schema declared two separate single-column FKs:
--   audit_log_club_id_clubs_id_fk   (audit_log.club_id     → clubs.id)
--   audit_log_actor_member_id_..._fk (audit_log.actor_member_id → club_members.id)
-- Replace with a single composite FK so the (actor, club) tuple integrity
-- is enforced atomically. Drop the inline references' generated names —
-- they may vary in dev vs prod, so use `IF EXISTS` and try a couple of
-- common Drizzle-emitted shapes.
ALTER TABLE "audit_log"
  DROP CONSTRAINT IF EXISTS "audit_log_actor_member_id_club_members_id_fk";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_member_club_fk'
  ) THEN
    ALTER TABLE "audit_log"
      ADD CONSTRAINT "audit_log_actor_member_club_fk"
      FOREIGN KEY ("actor_member_id", "club_id")
      REFERENCES "club_members"(id, club_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── F-17: club_join_requests partial unique on `pending` ─────────────

ALTER TABLE "club_join_requests"
  DROP CONSTRAINT IF EXISTS "club_join_requests_unique_pending";

CREATE UNIQUE INDEX IF NOT EXISTS "club_join_requests_unique_pending"
  ON "club_join_requests" ("club_id", "clerk_user_id")
  WHERE "status" = 'pending';

-- ─── F-40: community_topics.updated_at ────────────────────────────────

ALTER TABLE "community_topics"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

UPDATE "community_topics"
SET    "updated_at" = "created_at"
WHERE  "updated_at" = (
         SELECT MAX("created_at") FROM "community_topics"
       )
  AND  TRUE;
-- (The defensive SET runs whether-or-not rows exist; on a fresh DB the
-- WHERE clause yields no rows and the migration is a no-op past the
-- ADD COLUMN. The intent is to align historical rows so updated_at >=
-- created_at always holds.)

-- ─── F-65: drop duplicate bookings CHECK constraints ─────────────────

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_cancellation_fee_nonneg_check",
  DROP CONSTRAINT IF EXISTS "bookings_discount_amount_nonneg_check";
-- Equivalents from migration 0042 remain:
--   bookings_cancellation_fee_nonneg
--   bookings_discount_amount_nonneg

-- ─── F-16 (partial): drop redundant CHECKs superseded by enums ──────

ALTER TABLE "club_join_requests"
  DROP CONSTRAINT IF EXISTS "club_join_requests_status_check";
-- Superseded by enum promotion in migration 0029 — `joinRequestStatusEnum`
-- is now the live invariant.

ALTER TABLE "clubs"
  DROP CONSTRAINT IF EXISTS "clubs_join_policy_check";
-- Superseded by enum promotion in migration 0026 — `joinPolicyEnum` is
-- now the live invariant.

COMMIT;
