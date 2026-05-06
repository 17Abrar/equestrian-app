-- 2026-05-06 audit (third pass — comprehensive AUDIT_PROMPT.md run).
-- Closes F-1, F-8, F-11, F-12, F-13.
--
-- Migration 0017 added composite (horse_id, club_id) FKs to the six
-- horse-health sub-tables. Migration 0019 covered selected member
-- references. Migration 0038 extended the pattern to five more tables.
-- Migration 0039 covered the four adjacent tables a self-check found.
-- This migration finishes the program — every remaining single-column
-- FK that crosses a tenant boundary is promoted to a composite
-- (col, club_id) → parent(id, club_id), pulling the tenant invariant
-- into the schema layer for every child table.
--
-- ON DELETE behavior. Each new composite preserves the existing
-- single-column FK's ON DELETE behavior except for five sites the
-- comprehensive audit recommended tightening:
--   - bookings.slot_id          a → CASCADE   (booking is meaningless without slot)
--   - waitlist.slot_id          a → CASCADE   (same)
--   - payments.livery_contract_id  a → SET NULL  (preserve payment row, drop contract pointer)
--   - payments.invoice_id          a → SET NULL  (same)
--   - coupon_usages.booking_id     a → SET NULL  (preserve usage ledger when booking deleted)
--
-- Pre-clean (DELETE rows with mismatched club_id) probed against prod
-- 2026-05-06: zero rows on every relation. Cleanup blocks remain as
-- safety nets for any database that diverged.
--
-- F-11 (schema drift). Migration 0033 created a SECOND functionally-
-- identical UNIQUE on horses(id, club_id) — the original from 0017
-- was already in place. Drop the duplicate (`horses_id_club_id_unique`)
-- so the schema TS, which only declares the original
-- `horses_id_club_unique`, doesn't drift further.

-- ─── Step 1 — F-11 cleanup ─────────────────────────────────────────────

ALTER TABLE "horses" DROP CONSTRAINT IF EXISTS "horses_id_club_id_unique";

-- ─── Step 2 — orphan cleanup (zero rows in prod) ───────────────────────

DELETE FROM "horses" h USING "club_members" m
  WHERE h.owner_member_id IS NOT NULL AND m.id = h.owner_member_id AND m.club_id <> h.club_id;
DELETE FROM "booking_slots" b USING "lesson_types" l
  WHERE l.id = b.lesson_type_id AND l.club_id <> b.club_id;
DELETE FROM "booking_slots" b USING "arenas" a
  WHERE b.arena_id IS NOT NULL AND a.id = b.arena_id AND a.club_id <> b.club_id;
DELETE FROM "booking_slots" b USING "club_members" m
  WHERE b.coach_member_id IS NOT NULL AND m.id = b.coach_member_id AND m.club_id <> b.club_id;
DELETE FROM "bookings" b USING "booking_slots" s
  WHERE s.id = b.slot_id AND s.club_id <> b.club_id;
DELETE FROM "bookings" b USING "club_members" m
  WHERE m.id = b.booked_by_member_id AND m.club_id <> b.club_id;
DELETE FROM "bookings" b USING "club_members" m
  WHERE b.cancelled_by_member_id IS NOT NULL AND m.id = b.cancelled_by_member_id AND m.club_id <> b.club_id;
DELETE FROM "waitlist" w USING "booking_slots" s
  WHERE s.id = w.slot_id AND s.club_id <> w.club_id;
DELETE FROM "competition_entries" e USING "competition_classes" c
  WHERE c.id = e.class_id AND c.club_id <> e.club_id;
DELETE FROM "competition_entries" e USING "club_members" m
  WHERE m.id = e.rider_member_id AND m.club_id <> e.club_id;
DELETE FROM "competition_results" r USING "competition_entries" e
  WHERE e.id = r.entry_id AND e.club_id <> r.club_id;
DELETE FROM "horse_health_records" h USING "club_members" m
  WHERE h.created_by_member_id IS NOT NULL AND m.id = h.created_by_member_id AND m.club_id <> h.club_id;
DELETE FROM "horse_medication_logs" l USING "horse_medications" med
  WHERE med.id = l.medication_id AND med.club_id <> l.club_id;
DELETE FROM "horse_medication_logs" l USING "club_members" m
  WHERE l.administered_by_member_id IS NOT NULL AND m.id = l.administered_by_member_id AND m.club_id <> l.club_id;
DELETE FROM "horse_documents" d USING "club_members" m
  WHERE d.uploaded_by_member_id IS NOT NULL AND m.id = d.uploaded_by_member_id AND m.club_id <> d.club_id;
DELETE FROM "groom_tasks" t USING "club_members" m
  WHERE t.assigned_to_member_id IS NOT NULL AND m.id = t.assigned_to_member_id AND m.club_id <> t.club_id;
DELETE FROM "groom_tasks" t USING "club_members" m
  WHERE t.completed_by_member_id IS NOT NULL AND m.id = t.completed_by_member_id AND m.club_id <> t.club_id;
DELETE FROM "rider_achievements" r USING "club_members" m
  WHERE m.id = r.rider_member_id AND m.club_id <> r.club_id;
DELETE FROM "invoices" i USING "livery_contracts" lc
  WHERE i.livery_contract_id IS NOT NULL AND lc.id = i.livery_contract_id AND lc.club_id <> i.club_id;
DELETE FROM "payments" p USING "livery_contracts" lc
  WHERE p.livery_contract_id IS NOT NULL AND lc.id = p.livery_contract_id AND lc.club_id <> p.club_id;
DELETE FROM "payments" p USING "invoices" i
  WHERE p.invoice_id IS NOT NULL AND i.id = p.invoice_id AND i.club_id <> p.club_id;
DELETE FROM "expenses" e USING "club_members" m
  WHERE e.created_by_member_id IS NOT NULL AND m.id = e.created_by_member_id AND m.club_id <> e.club_id;
DELETE FROM "packages" p USING "lesson_types" l
  WHERE p.lesson_type_id IS NOT NULL AND l.id = p.lesson_type_id AND l.club_id <> p.club_id;
DELETE FROM "rider_packages" rp USING "packages" p
  WHERE p.id = rp.package_id AND p.club_id <> rp.club_id;
DELETE FROM "rider_packages" rp USING "club_members" m
  WHERE m.id = rp.rider_member_id AND m.club_id <> rp.club_id;
DELETE FROM "coupons" c USING "club_members" m
  WHERE c.created_by_member_id IS NOT NULL AND m.id = c.created_by_member_id AND m.club_id <> c.club_id;
DELETE FROM "coupon_usages" cu USING "coupons" c
  WHERE c.id = cu.coupon_id AND c.club_id <> cu.club_id;
DELETE FROM "coupon_usages" cu USING "club_members" m
  WHERE m.id = cu.rider_member_id AND m.club_id <> cu.club_id;
DELETE FROM "coupon_usages" cu USING "bookings" b
  WHERE cu.booking_id IS NOT NULL AND b.id = cu.booking_id AND b.club_id <> cu.club_id;
DELETE FROM "audiences" a USING "club_members" m
  WHERE a.created_by_member_id IS NOT NULL AND m.id = a.created_by_member_id AND m.club_id <> a.club_id;
DELETE FROM "competitions" c USING "arenas" a
  WHERE c.arena_id IS NOT NULL AND a.id = c.arena_id AND a.club_id <> c.club_id;

-- ─── Step 3 — add (id, club_id) UNIQUE on parent tables ────────────────
-- Required as the FK target for the composite. Each is wrapped in
-- `IF NOT EXISTS` for idempotency.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_id_club_unique') THEN
  ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_types_id_club_unique') THEN
  ALTER TABLE "lesson_types" ADD CONSTRAINT "lesson_types_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arenas_id_club_unique') THEN
  ALTER TABLE "arenas" ADD CONSTRAINT "arenas_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'livery_contracts_id_club_unique') THEN
  ALTER TABLE "livery_contracts" ADD CONSTRAINT "livery_contracts_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_id_club_unique') THEN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_classes_id_club_unique') THEN
  ALTER TABLE "competition_classes" ADD CONSTRAINT "competition_classes_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_id_club_unique') THEN
  ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_medications_id_club_unique') THEN
  ALTER TABLE "horse_medications" ADD CONSTRAINT "horse_medications_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_id_club_unique') THEN
  ALTER TABLE "packages" ADD CONSTRAINT "packages_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_id_club_unique') THEN
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_id_club_unique" UNIQUE (id, club_id);
END IF; END $$;

-- ─── Step 4 — drop existing single-column FKs ──────────────────────────

ALTER TABLE "horses" DROP CONSTRAINT IF EXISTS "horses_owner_member_id_club_members_id_fk";
ALTER TABLE "booking_slots" DROP CONSTRAINT IF EXISTS "booking_slots_lesson_type_id_lesson_types_id_fk";
ALTER TABLE "booking_slots" DROP CONSTRAINT IF EXISTS "booking_slots_arena_id_arenas_id_fk";
ALTER TABLE "booking_slots" DROP CONSTRAINT IF EXISTS "booking_slots_coach_member_id_club_members_id_fk";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_slot_id_booking_slots_id_fk";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_booked_by_member_id_club_members_id_fk";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_cancelled_by_member_id_club_members_id_fk";
ALTER TABLE "waitlist" DROP CONSTRAINT IF EXISTS "waitlist_slot_id_booking_slots_id_fk";
ALTER TABLE "competition_entries" DROP CONSTRAINT IF EXISTS "competition_entries_class_id_competition_classes_id_fk";
ALTER TABLE "competition_entries" DROP CONSTRAINT IF EXISTS "competition_entries_rider_member_id_club_members_id_fk";
ALTER TABLE "competition_results" DROP CONSTRAINT IF EXISTS "competition_results_entry_id_competition_entries_id_fk";
ALTER TABLE "horse_health_records" DROP CONSTRAINT IF EXISTS "horse_health_records_created_by_member_id_club_members_id_fk";
ALTER TABLE "horse_medication_logs" DROP CONSTRAINT IF EXISTS "horse_medication_logs_medication_id_horse_medications_id_fk";
ALTER TABLE "horse_medication_logs" DROP CONSTRAINT IF EXISTS "horse_medication_logs_administered_by_member_id_club_members_id";
ALTER TABLE "horse_documents" DROP CONSTRAINT IF EXISTS "horse_documents_uploaded_by_member_id_club_members_id_fk";
ALTER TABLE "groom_tasks" DROP CONSTRAINT IF EXISTS "groom_tasks_assigned_to_member_id_club_members_id_fk";
ALTER TABLE "groom_tasks" DROP CONSTRAINT IF EXISTS "groom_tasks_completed_by_member_id_club_members_id_fk";
ALTER TABLE "rider_achievements" DROP CONSTRAINT IF EXISTS "rider_achievements_rider_member_id_club_members_id_fk";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_livery_contract_id_livery_contracts_id_fk";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_livery_contract_id_livery_contracts_id_fk";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_invoice_id_invoices_id_fk";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_created_by_member_id_club_members_id_fk";
ALTER TABLE "packages" DROP CONSTRAINT IF EXISTS "packages_lesson_type_id_lesson_types_id_fk";
ALTER TABLE "rider_packages" DROP CONSTRAINT IF EXISTS "rider_packages_package_id_packages_id_fk";
ALTER TABLE "rider_packages" DROP CONSTRAINT IF EXISTS "rider_packages_rider_member_id_club_members_id_fk";
ALTER TABLE "coupons" DROP CONSTRAINT IF EXISTS "coupons_created_by_member_id_club_members_id_fk";
ALTER TABLE "coupon_usages" DROP CONSTRAINT IF EXISTS "coupon_usages_coupon_id_coupons_id_fk";
ALTER TABLE "coupon_usages" DROP CONSTRAINT IF EXISTS "coupon_usages_rider_member_id_club_members_id_fk";
ALTER TABLE "coupon_usages" DROP CONSTRAINT IF EXISTS "coupon_usages_booking_id_bookings_id_fk";
ALTER TABLE "audiences" DROP CONSTRAINT IF EXISTS "audiences_created_by_member_id_fkey";
ALTER TABLE "competitions" DROP CONSTRAINT IF EXISTS "competitions_arena_id_arenas_id_fk";

-- ─── Step 5 — add composite FKs ────────────────────────────────────────
-- ON DELETE preserved unless the comment marks (audit-recommended change).

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horses_owner_member_club_fk') THEN
  ALTER TABLE "horses" ADD CONSTRAINT "horses_owner_member_club_fk"
    FOREIGN KEY (owner_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_lesson_type_club_fk') THEN
  ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_lesson_type_club_fk"
    FOREIGN KEY (lesson_type_id, club_id) REFERENCES "lesson_types"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_arena_club_fk') THEN
  ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_arena_club_fk"
    FOREIGN KEY (arena_id, club_id) REFERENCES "arenas"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_coach_member_club_fk') THEN
  ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_coach_member_club_fk"
    FOREIGN KEY (coach_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

-- audit-recommended change: a → CASCADE (booking is meaningless without slot)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_slot_club_fk') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_club_fk"
    FOREIGN KEY (slot_id, club_id) REFERENCES "booking_slots"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_booked_by_member_club_fk') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_member_club_fk"
    FOREIGN KEY (booked_by_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancelled_by_member_club_fk') THEN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_member_club_fk"
    FOREIGN KEY (cancelled_by_member_id, club_id) REFERENCES "club_members"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

-- audit-recommended change: a → CASCADE
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_slot_club_fk') THEN
  ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_slot_club_fk"
    FOREIGN KEY (slot_id, club_id) REFERENCES "booking_slots"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_class_club_fk') THEN
  ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_class_club_fk"
    FOREIGN KEY (class_id, club_id) REFERENCES "competition_classes"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_entries_rider_member_club_fk') THEN
  ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_rider_member_club_fk"
    FOREIGN KEY (rider_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competition_results_entry_club_fk') THEN
  ALTER TABLE "competition_results" ADD CONSTRAINT "competition_results_entry_club_fk"
    FOREIGN KEY (entry_id, club_id) REFERENCES "competition_entries"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_health_records_created_by_member_club_fk') THEN
  ALTER TABLE "horse_health_records" ADD CONSTRAINT "horse_health_records_created_by_member_club_fk"
    FOREIGN KEY (created_by_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_medication_logs_medication_club_fk') THEN
  ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_medication_club_fk"
    FOREIGN KEY (medication_id, club_id) REFERENCES "horse_medications"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_medication_logs_administered_by_member_club_fk') THEN
  ALTER TABLE "horse_medication_logs" ADD CONSTRAINT "horse_medication_logs_administered_by_member_club_fk"
    FOREIGN KEY (administered_by_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_documents_uploaded_by_member_club_fk') THEN
  ALTER TABLE "horse_documents" ADD CONSTRAINT "horse_documents_uploaded_by_member_club_fk"
    FOREIGN KEY (uploaded_by_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groom_tasks_assigned_to_member_club_fk') THEN
  ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_assigned_to_member_club_fk"
    FOREIGN KEY (assigned_to_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groom_tasks_completed_by_member_club_fk') THEN
  ALTER TABLE "groom_tasks" ADD CONSTRAINT "groom_tasks_completed_by_member_club_fk"
    FOREIGN KEY (completed_by_member_id, club_id) REFERENCES "club_members"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_achievements_rider_member_club_fk') THEN
  ALTER TABLE "rider_achievements" ADD CONSTRAINT "rider_achievements_rider_member_club_fk"
    FOREIGN KEY (rider_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_livery_contract_club_fk') THEN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_livery_contract_club_fk"
    FOREIGN KEY (livery_contract_id, club_id) REFERENCES "livery_contracts"(id, club_id);
END IF; END $$;

-- audit-recommended change: a → SET NULL (preserve payment row, drop contract pointer)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_livery_contract_club_fk') THEN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_livery_contract_club_fk"
    FOREIGN KEY (livery_contract_id, club_id) REFERENCES "livery_contracts"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

-- audit-recommended change: a → SET NULL
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_invoice_club_fk') THEN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_club_fk"
    FOREIGN KEY (invoice_id, club_id) REFERENCES "invoices"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_created_by_member_club_fk') THEN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member_club_fk"
    FOREIGN KEY (created_by_member_id, club_id) REFERENCES "club_members"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_lesson_type_club_fk') THEN
  ALTER TABLE "packages" ADD CONSTRAINT "packages_lesson_type_club_fk"
    FOREIGN KEY (lesson_type_id, club_id) REFERENCES "lesson_types"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_packages_package_club_fk') THEN
  ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_package_club_fk"
    FOREIGN KEY (package_id, club_id) REFERENCES "packages"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rider_packages_rider_member_club_fk') THEN
  ALTER TABLE "rider_packages" ADD CONSTRAINT "rider_packages_rider_member_club_fk"
    FOREIGN KEY (rider_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_created_by_member_club_fk') THEN
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_member_club_fk"
    FOREIGN KEY (created_by_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usages_coupon_club_fk') THEN
  ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_coupon_club_fk"
    FOREIGN KEY (coupon_id, club_id) REFERENCES "coupons"(id, club_id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usages_rider_member_club_fk') THEN
  ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_rider_member_club_fk"
    FOREIGN KEY (rider_member_id, club_id) REFERENCES "club_members"(id, club_id);
END IF; END $$;

-- audit-recommended change: a → SET NULL (preserve usage ledger when booking deleted)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usages_booking_club_fk') THEN
  ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_booking_club_fk"
    FOREIGN KEY (booking_id, club_id) REFERENCES "bookings"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audiences_created_by_member_club_fk') THEN
  ALTER TABLE "audiences" ADD CONSTRAINT "audiences_created_by_member_club_fk"
    FOREIGN KEY (created_by_member_id, club_id) REFERENCES "club_members"(id, club_id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_arena_club_fk') THEN
  ALTER TABLE "competitions" ADD CONSTRAINT "competitions_arena_club_fk"
    FOREIGN KEY (arena_id, club_id) REFERENCES "arenas"(id, club_id);
END IF; END $$;
