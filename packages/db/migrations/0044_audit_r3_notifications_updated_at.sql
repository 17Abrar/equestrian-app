-- 2026-05-06 audit (round 3). Closes F-6.
--
-- `notifications` mutates `is_read` / `read_at` / `email_sent` /
-- `push_sent` / `sms_sent` post-create but had no `updated_at`,
-- breaking the every-table-has-the-standard-timestamps invariant.
-- Two adjacent ledger tables (couponUsages, webhookEvents) document
-- the omission as deliberate (write-once); notifications is NOT
-- write-once, so this is a real gap.
--
-- Backfill: existing rows get `updated_at = COALESCE(read_at,
-- created_at)` — best-effort signal of last-meaningful-mutation.
-- Future updates from `markNotificationRead` / `markDelivery*Sent`
-- will bump it normally.

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

UPDATE "notifications"
   SET updated_at = COALESCE(read_at, created_at)
 WHERE updated_at = created_at OR updated_at < created_at;
