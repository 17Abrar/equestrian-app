-- Drops the orphan RLS policies installed by 0003. Row-level security was
-- abandoned in favour of application-level club_id scoping because it forced
-- a WebSocket + transaction on every request (~150ms per click) and because
-- the default HTTP driver has no way to set `app.current_club_id` via
-- `current_setting()`.
--
-- Idempotent on every axis:
--   * `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` is a no-op when RLS is
--     already disabled.
--   * `DROP POLICY IF EXISTS` is a no-op when the policy is absent.
--   * The `pg_tables` existence check skips tables that don't exist on older
--     branches (e.g. a Neon preview that never ran 0006+).
--
-- Safe to re-run, safe to run on a DB that was fixed by hand.

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'rider_profiles', 'horses', 'horse_health_records', 'horse_medications',
    'horse_medication_logs', 'horse_feeding_plans', 'horse_feed_tracker',
    'horse_exercise_schedules', 'horse_documents', 'horse_pairing_history',
    'arenas', 'arena_schedules', 'lesson_types', 'booking_slots', 'bookings',
    'waitlist', 'coupons', 'coupon_usages', 'packages', 'rider_packages',
    'livery_contracts', 'invoices', 'payments', 'expenses', 'competitions',
    'competition_classes', 'competition_entries', 'competition_results',
    'groom_tasks', 'rider_achievements', 'notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    END IF;
  END LOOP;
END $$;
