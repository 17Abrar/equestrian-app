-- Rider audiences: named filter sets used to segment the rider base for
-- targeted emails. Filters are stored as jsonb so they evolve without a
-- migration (skill_level, active_within_days, has_active_package, etc.).
CREATE TABLE IF NOT EXISTS "audiences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_member_id" uuid REFERENCES "club_members"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_audiences_club" ON "audiences" ("club_id");

-- RLS: inherit the tenant scope pattern from 0003_rls_policies.
ALTER TABLE "audiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audiences" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "audiences";
CREATE POLICY "tenant_isolation" ON "audiences"
  USING ("club_id" = current_setting('app.current_club_id', true)::uuid)
  WITH CHECK ("club_id" = current_setting('app.current_club_id', true)::uuid);
