-- Row-Level Security policies for tenant isolation.
--
-- Every tenant-scoped table enables RLS and installs a `tenant_isolation`
-- policy that restricts rows to the club identified by the session variable
-- `app.current_club_id`. The session variable is set by `runInTenantContext`
-- in `packages/db/src/index.ts` before any tenant-scoped query runs.
--
-- FORCE ROW LEVEL SECURITY is required: Neon connections authenticate as the
-- database owner, and the owner bypasses RLS by default. FORCE applies the
-- policy even to the owner.
--
-- Tables exempt from RLS (accessed before tenant context can be resolved or
-- intentionally cross-club):
--   * clubs — the tenant root
--   * club_members — tenant resolution lookups
--   * audit_log — admin/observability, club_id nullable
--   * community_topics, community_posts, community_comments, community_votes
--     — community features span clubs
--
-- The policy uses `current_setting('app.current_club_id', true)::uuid`.
-- The `true` argument makes the function return NULL when the variable is
-- unset, so comparisons return NULL (treated as false) and no rows are
-- visible. This fails closed by default.

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'rider_profiles',
    'horses',
    'horse_health_records',
    'horse_medications',
    'horse_medication_logs',
    'horse_feeding_plans',
    'horse_feed_tracker',
    'horse_exercise_schedules',
    'horse_documents',
    'horse_pairing_history',
    'arenas',
    'arena_schedules',
    'lesson_types',
    'booking_slots',
    'bookings',
    'waitlist',
    'coupons',
    'coupon_usages',
    'packages',
    'rider_packages',
    'livery_contracts',
    'invoices',
    'payments',
    'expenses',
    'competitions',
    'competition_classes',
    'competition_entries',
    'competition_results',
    'groom_tasks',
    'rider_achievements',
    'notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (club_id = current_setting(''app.current_club_id'', true)::uuid) '
      'WITH CHECK (club_id = current_setting(''app.current_club_id'', true)::uuid)',
      tbl
    );
  END LOOP;
END $$;
