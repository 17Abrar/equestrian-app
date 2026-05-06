-- Round 6.2 — horse care reminders.
--
-- Generic dedup table for the new daily horse-care reminder cron. Four
-- reminder kinds today, all sharing the same shape:
--   - 'horse_health_record_due'   — `horse_health_records.next_due_date`
--                                    (vaccination, farrier, dental, etc.)
--   - 'horse_health_record_followup' — `horse_health_records.follow_up_date`
--                                    (vet follow-up after a treatment)
--   - 'horse_insurance'           — `horses.insurance_expiry`
--   - 'horse_medication_end'      — `horse_medications.end_date`
--
-- Each kind has its own threshold cadence (7/1/0 for due dates,
-- 30/7/1 for insurance, etc.). The dedup is keyed on
-- `(club_id, kind, source_id, threshold_days)` so the cron can ask
-- "have we already emailed about this row at this threshold?" without
-- adding a per-source-table reminder column.
--
-- Why a generic table instead of `last_reminder_at` columns on each
-- source: medications, health records, and horse insurance are
-- different domains. A column-per-table approach would scatter the
-- cadence logic and require migrations for every new reminder kind we
-- add later. One table + a `kind` discriminator keeps the cron
-- self-contained.

CREATE TABLE IF NOT EXISTS "horse_care_reminder_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs" ("id") ON DELETE CASCADE,
  "kind" varchar(50) NOT NULL,
  "source_id" uuid NOT NULL,
  "threshold_days" integer NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "horse_care_reminder_sends_unique"
  ON "horse_care_reminder_sends" ("club_id", "kind", "source_id", "threshold_days");

CREATE INDEX IF NOT EXISTS "idx_horse_care_reminder_sends_club"
  ON "horse_care_reminder_sends" ("club_id", "sent_at" DESC);
