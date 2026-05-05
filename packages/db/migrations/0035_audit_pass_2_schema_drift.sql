-- 2026-05-05 audit pass-2 closeout — schema-drift sweep.
--
-- Brings SQL state in line with TS schema declarations and closes the
-- residual drift findings from the second-pass audit:
--
-- 1. MED — community_topics.slug global unique → per-club composite
--    unique. The global form blocked two clubs from both having a
--    `general` / `events` / `announcements` topic.
-- 2. LOW — packages.lesson_type_id was a bare UUID with no FK,
--    permitting cross-tenant smuggling of arbitrary lesson-type IDs.
--    Add `references(lesson_types.id) ON DELETE SET NULL`.
-- 3. LOW — payments.package_id was a bare UUID with no FK, same
--    rationale. Add `references(rider_packages.id) ON DELETE SET NULL`.
--    Note: `riderPackages` is the rider's purchased instance, not the
--    catalog row — every `payments.package_id` write in the codebase
--    sources from a `rider_packages` lookup.
-- 4. NIT — drop dead `bookings.stripe_payment_intent_id` column +
--    `idx_bookings_stripe`. Migrated to `payment_provider` +
--    `provider_payment_id` in 0005; no current writer; the column has
--    been NULL for every row created since the cutover. Removing the
--    column drops the index automatically.
--
-- Idempotent — every step uses `IF EXISTS` / `IF NOT EXISTS` guards.

-- ─── 1. community_topics.slug per-club unique ───────────────────────
DO $$
BEGIN
  -- Drop the legacy global unique. `community_topics_slug_key` is the
  -- default name Postgres assigned when the column was declared
  -- `slug VARCHAR(100) UNIQUE`. Older databases may have a custom
  -- name; check both forms.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_topics_slug_key'
      AND conrelid = '"community_topics"'::regclass
  ) THEN
    ALTER TABLE "community_topics"
      DROP CONSTRAINT "community_topics_slug_key";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_topics_slug_unique'
      AND conrelid = '"community_topics"'::regclass
  ) THEN
    ALTER TABLE "community_topics"
      DROP CONSTRAINT "community_topics_slug_unique";
  END IF;

  -- Composite (club_id, slug). Postgres default UNIQUE treats NULL as
  -- distinct, so the system-default topics with `club_id IS NULL` don't
  -- block per-club rows from sharing the same slug.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_topics_club_slug_unique'
      AND conrelid = '"community_topics"'::regclass
  ) THEN
    ALTER TABLE "community_topics"
      ADD CONSTRAINT "community_topics_club_slug_unique" UNIQUE ("club_id", "slug");
  END IF;
END $$;

-- ─── 2. packages.lesson_type_id FK ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_lesson_type_id_lesson_types_id_fk'
      AND conrelid = '"packages"'::regclass
  ) THEN
    ALTER TABLE "packages"
      ADD CONSTRAINT "packages_lesson_type_id_lesson_types_id_fk"
      FOREIGN KEY ("lesson_type_id") REFERENCES "lesson_types"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 3. payments.package_id FK ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_package_id_rider_packages_id_fk'
      AND conrelid = '"payments"'::regclass
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_package_id_rider_packages_id_fk"
      FOREIGN KEY ("package_id") REFERENCES "rider_packages"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 4. drop dead bookings.stripe_payment_intent_id column ──────────
-- Drop the index first; dropping the column would cascade-drop the
-- index but the explicit form makes the intent obvious. Both guarded
-- on existence so re-running is safe.
DROP INDEX IF EXISTS "idx_bookings_stripe";

ALTER TABLE "bookings" DROP COLUMN IF EXISTS "stripe_payment_intent_id";
