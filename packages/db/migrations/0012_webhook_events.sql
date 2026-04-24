-- Exactly-once webhook processing. Providers (Stripe, N-Genius, Ziina,
-- Clerk) all deliver at-least-once — duplicate deliveries would otherwise
-- fire duplicate receipt emails and, in the livery-invoice flow, race on
-- the status transition between the check and the UPDATE.
--
-- Route handlers INSERT (provider, event_id) before doing work. The
-- unique constraint serialises concurrent duplicate deliveries; only one
-- caller sees the fresh insert and proceeds.
--
-- Old rows are not auto-expired by this schema. A weekly cron (or a
-- retention policy) should prune `processed_at < now() - interval '30 days'`
-- so the table doesn't grow unbounded.

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" varchar(50) NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "webhook_events_provider_event_unique"
    UNIQUE ("provider", "event_id")
);

CREATE INDEX IF NOT EXISTS "idx_webhook_events_processed_at"
  ON "webhook_events" ("processed_at");
