-- Audit 2026-04-26 — fix the column default on webhook_events.status.
-- Prior default `'processed'` contradicted the two-phase claim protocol
-- documented in the schema (rows start at `'received'`, transition to
-- `'processed'` on success). No caller actually relies on the default
-- (claimWebhookEvent always passes the value explicitly), so this is a
-- documentation/contract fix, not a runtime fix.

ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DEFAULT 'received';
