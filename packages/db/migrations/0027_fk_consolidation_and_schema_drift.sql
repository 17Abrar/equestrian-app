-- Audit C-11, C-12, H-5, H-7, H-9, H-10, H-14, H-16 — consolidates FK
-- ON DELETE actions, fixes schema drift, and closes the webhook_events
-- tenant scope + processed_at semantic. Run as a single migration so
-- partial application doesn't leave the schema half-converted.
--
-- The FK changes use DROP CONSTRAINT / ADD CONSTRAINT pairs because
-- Postgres doesn't have ALTER CONSTRAINT for FK actions. Each pair is
-- guarded by a DO block so re-runs against partially-applied state
-- don't crash.

-- ─── C-11: community_comments.parent_comment_id self-FK ───────────────
-- The schema declared `parent_comment_id` as a plain UUID with no FK,
-- so a moderator's hard-delete of a parent left orphan replies pointing
-- at a defunct UUID. Add the self-FK with cascade so the subtree is
-- removed atomically.

DO $$ BEGIN
  ALTER TABLE "community_comments"
    ADD CONSTRAINT "community_comments_parent_comment_id_fk"
    FOREIGN KEY ("parent_comment_id")
    REFERENCES "community_comments"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── C-12: audit_log FKs to SET NULL ──────────────────────────────────
-- Previously NO ACTION blocked club deletion entirely. Schema declares
-- both columns nullable so a deleted club / departed member is acceptable
-- (the audit trail survives, just without an actor handle).

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_club_id_clubs_id_fk";
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_club_id_clubs_id_fk"
  FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_actor_member_id_club_members_id_fk";
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_member_id_club_members_id_fk"
  FOREIGN KEY ("actor_member_id") REFERENCES "club_members"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H-7: rider_profiles.parent_member_id to SET NULL ─────────────────

ALTER TABLE "rider_profiles" DROP CONSTRAINT IF EXISTS "rider_profiles_parent_member_id_club_members_id_fk";
ALTER TABLE "rider_profiles"
  ADD CONSTRAINT "rider_profiles_parent_member_id_club_members_id_fk"
  FOREIGN KEY ("parent_member_id") REFERENCES "club_members"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H-14: bookings.coupon_id and bookings.package_id to SET NULL ─────
-- The booking's `discount_amount` snapshot preserves the financial
-- impact, so losing the FK link to an expired coupon doesn't corrupt
-- finance reporting. NO ACTION had blocked operators from archiving
-- old coupons or rider packages.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_coupon_id_coupons_id_fk";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_coupon_id_coupons_id_fk"
  FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_package_id_rider_packages_id_fk";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_package_id_rider_packages_id_fk"
  FOREIGN KEY ("package_id") REFERENCES "rider_packages"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H-16: misc FKs that still default to NO ACTION ──────────────────
-- Selecting `SET NULL` for informational columns (cancelled_by_member_id,
-- created_by_member_id, completed_by_member_id) and `SET NULL` for
-- ownership refs that aren't strictly load-bearing post-creation.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_cancelled_by_member_id_club_members_id_fk";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_cancelled_by_member_id_club_members_id_fk"
  FOREIGN KEY ("cancelled_by_member_id") REFERENCES "club_members"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_created_by_member_id_club_members_id_fk";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_created_by_member_id_club_members_id_fk"
  FOREIGN KEY ("created_by_member_id") REFERENCES "club_members"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "groom_tasks" DROP CONSTRAINT IF EXISTS "groom_tasks_completed_by_member_id_club_members_id_fk";
ALTER TABLE "groom_tasks"
  ADD CONSTRAINT "groom_tasks_completed_by_member_id_club_members_id_fk"
  FOREIGN KEY ("completed_by_member_id") REFERENCES "club_members"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- ─── H-9 / H-10: webhook_events.club_id + processed_at semantic ──────
-- Add nullable club_id (filled in by webhook handlers once the event
-- resolves to an account). Make processed_at nullable so a 'received'
-- or 'failed' row no longer carries a misleading processed_at = inserted_at;
-- the retention cron can then prune by `status='processed' AND processed_at <…`.

DO $$ BEGIN
  ALTER TABLE "webhook_events" ADD COLUMN "club_id" uuid;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "webhook_events"
    ADD CONSTRAINT "webhook_events_club_id_clubs_id_fk"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_webhook_events_club_status"
  ON "webhook_events" ("club_id", "status");

ALTER TABLE "webhook_events" ALTER COLUMN "processed_at" DROP DEFAULT;
ALTER TABLE "webhook_events" ALTER COLUMN "processed_at" DROP NOT NULL;

-- Backfill: rows that were marked 'received' / 'failed' before this
-- migration carry a misleading processed_at (= inserted_at). NULL them
-- so the retention cron's date filter doesn't sweep them up. Rows with
-- status='processed' keep their existing processed_at — that's the real
-- timestamp the success path stamped on them.
UPDATE "webhook_events"
   SET "processed_at" = NULL
 WHERE "status" IN ('received', 'failed', 'permanently_failed');

-- ─── H-5: livery_invoices partial unique index ──────────────────────
-- Replace the full unique on (horse_id, period_start) with a partial
-- unique that excludes 'cancelled' rows, so cancelling an invoice frees
-- the slot for re-issue. The cron's anchor logic already filters status
-- to pending|paid|overdue.

ALTER TABLE "livery_invoices" DROP CONSTRAINT IF EXISTS "livery_invoices_unique_horse_period";

DROP INDEX IF EXISTS "livery_invoices_unique_horse_period";

CREATE UNIQUE INDEX IF NOT EXISTS "livery_invoices_unique_horse_period_active"
  ON "livery_invoices" ("horse_id", "period_start")
  WHERE "status" <> 'cancelled';

-- ─── H-3: backfill legacy stripe_payment_intent_id rows ──────────────
-- Pre-2026 bookings stored Stripe PI ids only in the deprecated
-- `stripe_payment_intent_id` column. Webhook lookups now key off
-- `provider_payment_id`, so refunds/captures for those rows fall
-- through silently. Backfill.

UPDATE "bookings"
   SET "payment_provider" = 'stripe',
       "provider_payment_id" = "stripe_payment_intent_id"
 WHERE "stripe_payment_intent_id" IS NOT NULL
   AND "provider_payment_id" IS NULL;
