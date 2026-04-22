-- Public discovery and join policies. Round 7 — lets riders find and join
-- clubs without an invite.
ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "is_public_listing" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "join_policy" varchar(20) NOT NULL DEFAULT 'invite_only',
  ADD COLUMN IF NOT EXISTS "short_description" varchar(280);

-- CHECK constraint on join_policy so invalid values can't sneak in from the UI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clubs_join_policy_check'
  ) THEN
    ALTER TABLE "clubs"
      ADD CONSTRAINT "clubs_join_policy_check"
      CHECK ("join_policy" IN ('open', 'approval', 'invite_only'));
  END IF;
END $$;

-- Index used by the /discover listing query.
CREATE INDEX IF NOT EXISTS "idx_clubs_public_listing"
  ON "clubs" ("is_public_listing")
  WHERE "is_public_listing" = true AND "deleted_at" IS NULL;

-- Join requests: rider-initiated membership proposals that a club admin
-- approves or declines when join_policy = 'approval'. Open-policy clubs
-- skip this table and insert directly into club_members.
CREATE TABLE IF NOT EXISTS "club_join_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "clerk_user_id" varchar(255) NOT NULL,
  "email" varchar(255),
  "display_name" varchar(255),
  "message" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "reviewed_by_member_id" uuid REFERENCES "club_members"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "club_join_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT "club_join_requests_unique_pending"
    UNIQUE ("club_id", "clerk_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_join_requests_club_status"
  ON "club_join_requests" ("club_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_join_requests_user"
  ON "club_join_requests" ("clerk_user_id");

ALTER TABLE "club_join_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "club_join_requests" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "club_join_requests";
CREATE POLICY "tenant_isolation" ON "club_join_requests"
  USING ("club_id" = current_setting('app.current_club_id', true)::uuid)
  WITH CHECK ("club_id" = current_setting('app.current_club_id', true)::uuid);
