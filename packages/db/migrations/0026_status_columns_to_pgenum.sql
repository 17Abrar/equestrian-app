-- Audit AI-36 — promote varchar(20) status columns to pgEnum so the DB
-- rejects unknown values at write time. The application layer already
-- gates these via Zod, but DB-level enforcement is defence-in-depth and
-- saves a future bad query/migration from silently planting an invalid
-- value.
--
-- Pattern per column:
--   1. CREATE TYPE … (idempotent via DROP/CREATE-style guard)
--   2. ALTER TABLE … ALTER COLUMN … DROP DEFAULT
--      (ALTER COLUMN TYPE refuses to convert a default expression typed
--      as text to the new enum.)
--   3. ALTER TABLE … ALTER COLUMN … TYPE new_enum USING column::new_enum
--   4. ALTER TABLE … ALTER COLUMN … SET DEFAULT '<value>'
--      (literal cast to enum is implicit on assignment.)
--
-- All ALTER TABLE statements take an exclusive lock on the table for the
-- duration of the conversion. Tables involved are small (clubs is one
-- row per tenant; competitions/waitlist/webhook_events are bounded by
-- usage) so the lock window is sub-second on JSR's data volume.
--
-- Pre-flight: every existing value MUST be in the corresponding enum
-- type, else `USING column::new_enum` throws `invalid input value`.
-- The application layer has only ever written values from the Zod
-- enums; this migration enumerates every value the code emits today.

-- ─── competitions.status ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "competition_status" AS ENUM (
    'draft', 'published', 'in_progress', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "competitions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "competitions"
  ALTER COLUMN "status" TYPE "competition_status"
  USING "status"::"competition_status";
ALTER TABLE "competitions" ALTER COLUMN "status" SET DEFAULT 'draft';

-- ─── competition_entries.status ───────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "competition_entry_status" AS ENUM (
    'registered', 'withdrawn', 'scratched', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "competition_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "competition_entries"
  ALTER COLUMN "status" TYPE "competition_entry_status"
  USING "status"::"competition_entry_status";
ALTER TABLE "competition_entries" ALTER COLUMN "status" SET DEFAULT 'registered';

-- ─── clubs.subscription_tier ──────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "subscription_tier" AS ENUM (
    'trial', 'starter', 'growing', 'professional'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "clubs" ALTER COLUMN "subscription_tier" DROP DEFAULT;
ALTER TABLE "clubs"
  ALTER COLUMN "subscription_tier" TYPE "subscription_tier"
  USING "subscription_tier"::"subscription_tier";
ALTER TABLE "clubs" ALTER COLUMN "subscription_tier" SET DEFAULT 'trial';

-- ─── clubs.join_policy ────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "join_policy" AS ENUM ('open', 'invite_only', 'approval');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "clubs" ALTER COLUMN "join_policy" DROP DEFAULT;
ALTER TABLE "clubs"
  ALTER COLUMN "join_policy" TYPE "join_policy"
  USING "join_policy"::"join_policy";
ALTER TABLE "clubs" ALTER COLUMN "join_policy" SET DEFAULT 'invite_only';

-- ─── club_join_requests.status ────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "join_request_status" AS ENUM (
    'pending', 'approved', 'declined', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "club_join_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "club_join_requests"
  ALTER COLUMN "status" TYPE "join_request_status"
  USING "status"::"join_request_status";
ALTER TABLE "club_join_requests" ALTER COLUMN "status" SET DEFAULT 'pending';

-- ─── waitlist.status ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "waitlist_status" AS ENUM (
    'waiting', 'notified', 'expired', 'claimed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "waitlist" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "waitlist"
  ALTER COLUMN "status" TYPE "waitlist_status"
  USING "status"::"waitlist_status";
ALTER TABLE "waitlist" ALTER COLUMN "status" SET DEFAULT 'waiting';

-- ─── webhook_events.status ────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "webhook_event_status" AS ENUM (
    'received', 'processing', 'processed', 'failed', 'permanently_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "webhook_events" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "webhook_events"
  ALTER COLUMN "status" TYPE "webhook_event_status"
  USING "status"::"webhook_event_status";
ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DEFAULT 'received';
