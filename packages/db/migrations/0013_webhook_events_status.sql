-- Status tracking for webhook idempotency.
--
-- Previously a row in `webhook_events` just meant "we saw this event" —
-- but the handler inserted the row BEFORE processing, so a processing
-- failure that logged-and-returned-200 left a bogus dedup record that
-- silently dropped every future retry of the same event. A Stripe
-- `payment_intent.succeeded` that tripped a transient Neon error would
-- never be recovered: the provider got its 200, the booking stayed
-- `pending` forever.
--
-- The new pattern: INSERT marks the row `received` (claimed). On
-- success the handler UPDATEs to `processed`; on failure to `failed`
-- and returns 5xx so the provider retries. Only rows with
-- `status = 'processed'` are treated as "done"; `'received'` within the
-- stale window is "another worker has it"; `'failed'` or stale
-- `'received'` is "free to re-claim on the next retry".
--
-- Existing rows default to 'processed' because retroactively we can't
-- tell which of them actually succeeded — and the alternative
-- (replaying them all) would send duplicate emails and fire duplicate
-- refunds. New events flow through the correct pattern from here.

ALTER TABLE "webhook_events"
  ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "last_attempted_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_error" text;

CREATE INDEX IF NOT EXISTS "idx_webhook_events_status"
  ON "webhook_events" ("status", "last_attempted_at");
