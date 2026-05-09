-- 2026-05-09 audit pass-2 — cron robustness (C-1).
--
-- Adds per-club dedup columns for the trial-ending reminder cron.
-- `sendTrialEndingNudges` previously relied on the date check
-- `trial_ends_at::date = (today + daysOut)` for dedup, which works
-- as long as the cron is single-invocation per UTC day. Cloudflare
-- Workers' `scheduled()` retries 5xx via worker-entry; an inner-loop
-- failure during the email send bubbles up to the outer 500, and the
-- retried isolate re-fires every nudge whose date predicate still
-- matches.
--
-- The new columns let `markTrialReminderSent` CAS-guard each (clubId,
-- daysOut) pair: `UPDATE … SET trial_reminder_${daysOut}day_sent_at =
-- now() WHERE … AND trial_reminder_${daysOut}day_sent_at IS NULL
-- RETURNING id`. Second isolate observes the first one's NOW() and
-- the UPDATE returns zero rows.
--
-- Idempotent: column add is wrapped in IF NOT EXISTS guards so re-
-- running on an already-migrated DB is a no-op.

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS trial_reminder_3day_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_reminder_1day_sent_at timestamptz;
