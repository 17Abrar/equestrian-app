-- 2026-05-09 audit pass-2 — webhook secret history (D-1).
--
-- Companion to F-33's `club_payment_accounts.webhook_secret_hash`
-- partial UNIQUE (migration 0051). That index enforces "no two
-- CURRENTLY-CONNECTED clubs share the same hash" — but when a club
-- disconnects (or rotates to a fresh secret), their old hash leaves
-- the live table and the F-33 check stops covering it. Without this
-- companion table, a club could paste a different club's recently-
-- retired secret post-disconnect and start receiving webhooks signed
-- with that secret.
--
-- This migration adds the `burned_webhook_secret_hashes` table.
-- `upsertPaymentAccount` and `disconnectPaymentAccount` now insert
-- the previous hash here whenever it leaves the live row, AND
-- pre-check incoming hashes against this table. Together with the
-- F-33 partial UNIQUE, the system maintains "no club can use any
-- hash currently live OR previously retired".
--
-- Idempotent — `IF NOT EXISTS` guards.

CREATE TABLE IF NOT EXISTS burned_webhook_secret_hashes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider payment_provider NOT NULL,
  secret_hash varchar(64) NOT NULL,
  club_id uuid REFERENCES clubs(id) ON DELETE SET NULL,
  retired_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS burned_webhook_secret_hashes_provider_hash_unique
  ON burned_webhook_secret_hashes (provider, secret_hash);

CREATE INDEX IF NOT EXISTS idx_burned_webhook_secret_hashes_lookup
  ON burned_webhook_secret_hashes (provider, secret_hash);
