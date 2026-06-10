-- 0067_audit_pass_11_horse_leases_idempotent.sql
--
-- Audit pass-11 (2026-06-06), finding db-migrations-1.
--
-- 0064_horse_leases.sql created `lease_type` / `lease_status` with BARE,
-- unguarded `CREATE TYPE` and no `--> statement-breakpoint` markers. The
-- migrate-neon.mjs runner therefore executes the whole file as a single
-- query; on a Neon test-branch fork (where the enums already exist on the
-- parent branch but `horse_leases` does not) the first `CREATE TYPE` throws
-- 42710, which the runner swallows and `continue`s, leaving the table and its
-- indexes NEVER created — yet 0064 is recorded as applied.
--
-- We do NOT edit 0064 (drizzle-kit tracks a journal hash; editing applied
-- history causes silent skips). Instead this idempotent forward migration
-- guarantees the enums, table, and indexes exist. It is a complete no-op where
-- 0064 applied correctly, and self-heals the fork scenario.
--
-- Every statement is breakpoint-delimited so the runner executes them
-- individually; each CREATE TYPE is wrapped in the established
-- DO/EXCEPTION-duplicate_object guard, and the table/indexes use IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "lease_type" AS ENUM ('half', 'full');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "lease_status" AS ENUM ('pending', 'active', 'ended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "horse_leases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "horse_id" uuid NOT NULL,
  "lessee_member_id" uuid NOT NULL,
  "lease_type" "lease_type" NOT NULL,
  "monthly_fee_minor" integer NOT NULL,
  "currency" varchar(3) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" "lease_status" NOT NULL DEFAULT 'pending',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "horse_leases_horse_club_fk"
    FOREIGN KEY ("horse_id", "club_id")
    REFERENCES "horses"("id", "club_id") ON DELETE CASCADE,
  CONSTRAINT "horse_leases_lessee_club_fk"
    FOREIGN KEY ("lessee_member_id", "club_id")
    REFERENCES "club_members"("id", "club_id"),
  CONSTRAINT "horse_leases_date_range_check"
    CHECK ("end_date" >= "start_date"),
  CONSTRAINT "horse_leases_monthly_fee_nonneg_check"
    CHECK ("monthly_fee_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_horse_leases_club_status"
  ON "horse_leases" ("club_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_horse_leases_horse_status"
  ON "horse_leases" ("horse_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_horse_leases_lessee_status"
  ON "horse_leases" ("lessee_member_id", "status");
