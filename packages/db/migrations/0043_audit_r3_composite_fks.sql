-- 2026-05-06 audit (round 3). Closes F-1 + F-2 + F-3 + F-4 + F-5.
--
-- Five tenant-scoped single-column FKs that the systematic
-- composite-FK sweeps (0017 / 0019 / 0027 / 0038 / 0039 / 0040 /
-- 0041) missed. None is exploitable today because the corresponding
-- routes either don't accept the offending column from input or
-- resolve it via tenant-scoped lookups before insert. Closing the
-- DB-layer gap brings every member/coupon/package reference under
-- the same defense-in-depth invariant.
--
-- All five columns are nullable. Postgres MATCH SIMPLE (the default)
-- skips composite-FK enforcement when any FK column is NULL, so a
-- nullable parent_id on a non-null club_id remains acceptable —
-- same semantics as the prior single-column FK.
--
-- Pre-flight probe (2026-05-06) showed zero orphan / cross-tenant
-- rows on every relation. Cleanup blocks omitted.

-- ─── Step 0 — parent UNIQUE for rider_packages ────────────────────────
-- bookings.package_id and payments.package_id need a (id, club_id)
-- UNIQUE on rider_packages to target. The 0040 sweep added this for
-- packages but missed rider_packages.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_packages_id_club_unique') THEN
  ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;

-- ─── F-1 — notifications.recipient_member_id ───────────────────────────

ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_recipient_member_id_club_members_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_recipient_member_club_fk') THEN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_member_club_fk"
    FOREIGN KEY ("recipient_member_id", "club_id") REFERENCES "club_members"(id, club_id);
  -- ON DELETE NO ACTION (no clause): notifications inherit their
  -- recipient's lifecycle through the existing single-column
  -- `recipient_member_id` constraint chain. Keeping NO ACTION
  -- preserves the prior behaviour exactly. `notifications.club_id`
  -- is nullable for system-level notifications; MATCH SIMPLE skips
  -- the composite check when club_id is NULL.
END IF; END $$;

-- ─── F-2 — club_join_requests.reviewed_by_member_id ────────────────────

ALTER TABLE "club_join_requests"
  DROP CONSTRAINT IF EXISTS "club_join_requests_reviewed_by_member_id_fkey";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_join_requests_reviewed_by_member_club_fk') THEN
  ALTER TABLE "club_join_requests" ADD CONSTRAINT "club_join_requests_reviewed_by_member_club_fk"
    FOREIGN KEY ("reviewed_by_member_id", "club_id") REFERENCES "club_members"(id, club_id)
    ON DELETE SET NULL;
END IF; END $$;

-- ─── F-3 — bookings.coupon_id ──────────────────────────────────────────

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_coupon_id_coupons_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_coupon_club_fk') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coupon_club_fk"
    FOREIGN KEY ("coupon_id", "club_id") REFERENCES "coupons"(id, club_id)
    ON DELETE SET NULL;
END IF; END $$;

-- ─── F-4 — bookings.package_id ─────────────────────────────────────────

ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_package_id_rider_packages_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_package_club_fk') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_club_fk"
    FOREIGN KEY ("package_id", "club_id") REFERENCES "rider_packages"(id, club_id)
    ON DELETE SET NULL;
END IF; END $$;

-- ─── F-5 — payments.package_id (audit caught a misleading comment) ─────

ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_package_id_rider_packages_id_fk";

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_package_club_fk') THEN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_package_club_fk"
    FOREIGN KEY ("package_id", "club_id") REFERENCES "rider_packages"(id, club_id)
    ON DELETE SET NULL;
END IF; END $$;
