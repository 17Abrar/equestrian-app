-- Guest booking fields were added in-flight (commit 717d266, 2026-04-23)
-- but the migration was never checked in. Production applied the DDL
-- directly; this file brings the migrations folder in sync so a fresh
-- DB (test harness, new environment) ends up with the same shape.
--
-- All additions are guarded with IF NOT EXISTS so running against prod
-- is a no-op. The CHECK constraint + partial unique indexes are
-- created only if absent.
--
-- CHECK: when `is_guest_booking` is true, the guest contact fields are
-- required.
--
-- UNIQUE INDEXES:
--   * A rider can book themselves into a slot at most once (non-guest).
--   * A guest email can only appear once per slot (prevents the same
--     rider double-booking the same friend).

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "is_guest_booking" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "guest_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "guest_email" varchar(255),
  ADD COLUMN IF NOT EXISTS "guest_phone" varchar(50),
  ADD COLUMN IF NOT EXISTS "guest_skill_level" varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_guest_contact_required_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_guest_contact_required_check"
      CHECK (
        is_guest_booking = false
        OR (
          guest_name IS NOT NULL
          AND guest_email IS NOT NULL
          AND guest_phone IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_bookings_unique_rider_slot"
  ON "bookings" ("rider_member_id", "slot_id")
  WHERE is_guest_booking = false
    AND status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_bookings_unique_guest_slot"
  ON "bookings" (lower("guest_email"), "slot_id")
  WHERE is_guest_booking = true
    AND status <> 'cancelled'
    AND guest_email IS NOT NULL;
