-- Round 8 — horse ownership registration + livery billing surface.
-- Riders register their own horses; admins approve with a monthly livery fee.
-- Ownership status is separate from operational status (available / resting /
-- injured) because the two dimensions are orthogonal: a pending horse is not
-- yet "available" for lessons, and an active horse can still be "resting".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ownership_status') THEN
    CREATE TYPE "ownership_status" AS ENUM ('pending', 'active', 'retired', 'declined');
  END IF;
END $$;

ALTER TABLE "horses"
  ADD COLUMN IF NOT EXISTS "ownership_status" "ownership_status" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "monthly_livery_fee_minor" integer,
  ADD COLUMN IF NOT EXISTS "livery_start_date" date,
  ADD COLUMN IF NOT EXISTS "livery_end_date" date,
  ADD COLUMN IF NOT EXISTS "ownership_decline_reason" text,
  ADD COLUMN IF NOT EXISTS "ownership_submitted_at" timestamptz;

-- Every existing horse pre-dates this feature and was created by an admin, so
-- it's implicitly "active" ownership. Default covers new inserts; this backfill
-- is a no-op on the default but kept explicit for clarity.
UPDATE "horses" SET "ownership_status" = 'active' WHERE "ownership_status" IS NULL;

-- Partial index: the admin "Pending approvals" tab is the only read path that
-- cares about this status, and it only looks at pending rows.
CREATE INDEX IF NOT EXISTS "idx_horses_ownership_pending"
  ON "horses" ("club_id", "ownership_submitted_at" DESC)
  WHERE "ownership_status" = 'pending' AND "deleted_at" IS NULL;

-- Owner-scoped lookups: "my horses" in the rider portal.
CREATE INDEX IF NOT EXISTS "idx_horses_owner_status"
  ON "horses" ("owner_member_id", "ownership_status")
  WHERE "owner_member_id" IS NOT NULL AND "deleted_at" IS NULL;
