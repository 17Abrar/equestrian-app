-- 2026-05-06 audit (third pass — adjacent-table follow-up).
--
-- Migration 0038 closed five tables flagged by the third-pass audit
-- (groom_tasks, livery_invoices ×2, competition_entries, expenses,
-- bookings.rider_member_id). A self-check after 0038 surfaced four
-- adjacent tables that fit the same single-column-tenant-FK pattern
-- but were not in the audit's explicit list:
--
--   - livery_contracts.horse_id
--   - livery_contracts.owner_member_id
--   - horse_pairing_history.horse_id
--   - horse_pairing_history.rider_member_id
--   - waitlist.rider_member_id
--
-- Same defense-in-depth motivation as 0038. Each ON DELETE behavior
-- below was probed against the live constraint and is preserved
-- byte-for-byte: this migration moves the invariant into a composite
-- key without changing the deletion semantics anyone currently relies
-- on. A future operator who wants to relax / tighten ON DELETE on any
-- of these can do so in a separate migration with its own review.
--
-- Pre-clean (DELETE rows with mismatched club_id) mirrors 0017/0038.
-- Production has zero such rows today.
--
-- Constraint-name hygiene: matches the `{table}_{col}_club_fk` shape
-- 0017/0019/0038 already use, so a future grep for tenant FKs lands
-- in one consistent set.

-- Step 1 — orphan cleanup --------------------------------------------

DELETE FROM "livery_contracts" c USING "horses" h
WHERE h.id = c.horse_id AND h.club_id <> c.club_id;

DELETE FROM "livery_contracts" c USING "club_members" m
WHERE m.id = c.owner_member_id AND m.club_id <> c.club_id;

DELETE FROM "horse_pairing_history" p USING "horses" h
WHERE h.id = p.horse_id AND h.club_id <> p.club_id;

DELETE FROM "horse_pairing_history" p USING "club_members" m
WHERE m.id = p.rider_member_id AND m.club_id <> p.club_id;

DELETE FROM "waitlist" w USING "club_members" m
WHERE m.id = w.rider_member_id AND m.club_id <> w.club_id;

-- Step 2 — drop existing single-column FKs ---------------------------
-- Names sourced from `pg_constraint` against the live DB (probed
-- 2026-05-06). `IF EXISTS` so the migration is idempotent.

ALTER TABLE "livery_contracts"
  DROP CONSTRAINT IF EXISTS "livery_contracts_horse_id_horses_id_fk";

ALTER TABLE "livery_contracts"
  DROP CONSTRAINT IF EXISTS "livery_contracts_owner_member_id_club_members_id_fk";

ALTER TABLE "horse_pairing_history"
  DROP CONSTRAINT IF EXISTS "horse_pairing_history_horse_id_horses_id_fk";

ALTER TABLE "horse_pairing_history"
  DROP CONSTRAINT IF EXISTS "horse_pairing_history_rider_member_id_club_members_id_fk";

ALTER TABLE "waitlist"
  DROP CONSTRAINT IF EXISTS "waitlist_rider_member_id_club_members_id_fk";

-- Step 3 — composite FKs ---------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'livery_contracts_horse_club_fk') THEN
    ALTER TABLE "livery_contracts"
      ADD CONSTRAINT "livery_contracts_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id");
    -- ON DELETE NO ACTION (preserve existing). Contracts represent a
    -- legal agreement; deleting the horse should require operators
    -- to deliberately end the contract first, not silently cascade.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'livery_contracts_owner_member_club_fk') THEN
    ALTER TABLE "livery_contracts"
      ADD CONSTRAINT "livery_contracts_owner_member_club_fk"
      FOREIGN KEY ("owner_member_id", "club_id")
      REFERENCES "club_members"("id", "club_id");
    -- ON DELETE NO ACTION (preserve existing). Same as above:
    -- contracts outlive their counterparties and should never be
    -- silently dropped.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_pairing_history_horse_club_fk') THEN
    ALTER TABLE "horse_pairing_history"
      ADD CONSTRAINT "horse_pairing_history_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id")
      REFERENCES "horses"("id", "club_id")
      ON DELETE CASCADE;
    -- CASCADE preserved (a pairing record is meaningless without the
    -- horse it paired). Matches the existing single-column FK.
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horse_pairing_history_rider_member_club_fk') THEN
    ALTER TABLE "horse_pairing_history"
      ADD CONSTRAINT "horse_pairing_history_rider_member_club_fk"
      FOREIGN KEY ("rider_member_id", "club_id")
      REFERENCES "club_members"("id", "club_id")
      ON DELETE CASCADE;
    -- CASCADE preserved (a pairing record without the rider is also
    -- meaningless — these are training-quality datapoints scoped to
    -- the rider/horse pair).
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_rider_member_club_fk') THEN
    ALTER TABLE "waitlist"
      ADD CONSTRAINT "waitlist_rider_member_club_fk"
      FOREIGN KEY ("rider_member_id", "club_id")
      REFERENCES "club_members"("id", "club_id");
    -- ON DELETE NO ACTION (preserve existing). Member deletion should
    -- be blocked at the DB layer if waitlist entries remain — forces
    -- operators to clear the waitlist explicitly through the
    -- application path.
  END IF;
END $$;
