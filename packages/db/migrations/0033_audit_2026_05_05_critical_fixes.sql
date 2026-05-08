-- 2026-05-05 audit closeout — full-scope critical fixes.
--
-- 1. CRIT-1: composite (horse_id, club_id) FK on bookings.
--    Migration 0017 added composite FKs to every horse SUB-table
--    (health, medications, feeding, exercise, documents) but missed
--    `bookings.horse_id` itself. Single-column FK → cross-tenant
--    horse smuggling on booking insert. Add the composite (the route
--    layer also got a `getHorseById(ctx.clubId, …)` precheck — this
--    is defense-in-depth at the schema).
--
-- 2. CRIT-4: drop dead `'processing'` value from `webhook_event_status`.
--    Enum declares it; zero callers ever set it; staleness reclaim
--    only handles `'received'`/`'failed'`, so any future row stuck in
--    `processing` would be permanently un-reclaimable. Re-create the
--    enum without the value and rebind the column.
--
-- 3. LOW-7: drop dangling `bookings_application_fee_nonneg_check`
--    constraint left over after migration 0030 dropped the column.
--    Postgres usually drops attached CHECKs with the column, but
--    confirming with an explicit DROP IF EXISTS is cheap and safer
--    against any drift.
--
-- 4. MED-10: composite (booking_id, club_id) FK on payments.
--    `payments` has no current writer (audit HIGH-11) but if one
--    lands without this guard, cross-tenant child-row planting
--    becomes possible. Same pattern as bookings/horse-subtables.
--
-- 5. LOW-6: composite index on audit_log (club_id, action, created_at)
--    so filter-by-action queries don't table-scan once the table grows.
--
-- All steps idempotent EXCEPT the CRIT-4 webhook_events.status TYPE swap
-- (lines 106-113 below). Audit F-27 (2026-05-08 r6): the
-- `ALTER TABLE … ALTER COLUMN status TYPE …` block runs unconditionally
-- and the post-rename `DROP TYPE IF EXISTS "webhook_event_status";` /
-- `ALTER TYPE … RENAME TO …` pair is idempotent only if the v2 enum
-- already exists. The migrations runner tracks per-tag application so a
-- forward apply never re-runs the file; if you ever rerun this file by
-- hand against an already-migrated database, the ALTERs will fail
-- (column already on the renamed enum, source enum already gone). Don't
-- — re-run the migration runner instead, which skips applied tags.

-- ─── 1. CRIT-1: bookings.horse_id composite FK ────────────────────────
DO $$
BEGIN
  -- Drop the single-column FK if it exists (migration 0000 created it).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_horse_id_horses_id_fk'
  ) THEN
    ALTER TABLE "bookings"
      DROP CONSTRAINT "bookings_horse_id_horses_id_fk";
  END IF;

  -- Composite FK target — `horses` already has UNIQUE(id, club_id)
  -- because `id` is PK (added explicitly in earlier migrations for
  -- the same composite-FK pattern; if missing, add it).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horses_id_club_id_unique'
      AND conrelid = '"horses"'::regclass
  ) THEN
    ALTER TABLE "horses"
      ADD CONSTRAINT "horses_id_club_id_unique" UNIQUE ("id", "club_id");
  END IF;

  -- Add the composite FK with ON DELETE SET NULL — matches the
  -- bookings-soft-delete invariant (a horse delete shouldn't cascade
  -- into deleting historical bookings).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_horse_club_fk'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_horse_club_fk"
      FOREIGN KEY ("horse_id", "club_id") REFERENCES "horses"("id", "club_id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 2. CRIT-4: drop 'processing' from webhook_event_status enum ─────
-- Postgres enums can't drop values directly; recreate without it.
-- First confirm no rows actually hold the value (safety check —
-- code grep was clean but production may have been seeded by some
-- ad-hoc path).
DO $$
DECLARE
  v_processing_count integer;
BEGIN
  SELECT COUNT(*) INTO v_processing_count
  FROM webhook_events
  WHERE status::text = 'processing';

  IF v_processing_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0033 aborted: % webhook_events row(s) hold status=''processing''. Inspect and resolve before re-running.',
      v_processing_count;
  END IF;
END $$;

-- Replace the enum.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status_v2'
  ) THEN
    CREATE TYPE "webhook_event_status_v2" AS ENUM (
      'received',
      'processed',
      'failed',
      'permanently_failed'
    );
  END IF;
END $$;

ALTER TABLE "webhook_events"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "webhook_event_status_v2"
    USING "status"::text::"webhook_event_status_v2",
  ALTER COLUMN "status" SET DEFAULT 'received';

DROP TYPE IF EXISTS "webhook_event_status";
ALTER TYPE "webhook_event_status_v2" RENAME TO "webhook_event_status";

-- ─── 3. LOW-7: drop dangling bookings_application_fee_nonneg_check ───
ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_application_fee_nonneg_check";

-- ─── 4. MED-10: payments composite (booking_id, club_id) FK ──────────
-- Bookings already has UNIQUE(id) by virtue of the PK, but a composite
-- FK target needs UNIQUE(id, club_id) on bookings to bind the FK to
-- the same club_id as the parent. Add if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_id_club_id_unique'
      AND conrelid = '"bookings"'::regclass
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_id_club_id_unique" UNIQUE ("id", "club_id");
  END IF;

  -- Drop the existing single-column FK on payments.booking_id if any.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_booking_id_bookings_id_fk'
  ) THEN
    ALTER TABLE "payments"
      DROP CONSTRAINT "payments_booking_id_bookings_id_fk";
  END IF;

  -- Composite FK with ON DELETE SET NULL — payments.booking_id is
  -- nullable (some payments are for livery invoices, not bookings).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_booking_club_fk'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_booking_club_fk"
      FOREIGN KEY ("booking_id", "club_id") REFERENCES "bookings"("id", "club_id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 5. LOW-6: audit_log composite filter index ──────────────────────
CREATE INDEX IF NOT EXISTS "idx_audit_log_club_action_date"
  ON "audit_log" ("club_id", "action", "created_at" DESC);
