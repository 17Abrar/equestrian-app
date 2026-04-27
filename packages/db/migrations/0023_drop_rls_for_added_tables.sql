-- Audit F-8: Migration 0011 dropped RLS only on tables that existed at the
-- time of 0003's tenant policy, but 0004 / 0007 / 0008 later added RLS
-- policies to `club_payment_accounts`, `audiences`, and `club_join_requests`
-- without removing them when 0011 ran. Application code reads these tables
-- via `db` (the HTTP driver) which never sets `app.current_club_id`, so
-- under RLS each query returns zero rows — silently breaking the connected-
-- payment-accounts list and audiences preview UI.
--
-- Production was hand-fixed before this migration was committed (the
-- features work today). This migration locks the DDL state in for any
-- fresh deploy.
--
-- Same idempotent pattern as 0011 — safe to re-run.

DO $$
DECLARE
  tbl text;
  late_tables text[] := ARRAY[
    'club_payment_accounts', 'audiences', 'club_join_requests'
  ];
BEGIN
  FOREACH tbl IN ARRAY late_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    END IF;
  END LOOP;
END $$;
