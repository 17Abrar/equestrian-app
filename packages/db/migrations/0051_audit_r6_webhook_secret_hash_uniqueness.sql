-- Audit Round 6 — F-33 webhook-secret-hash uniqueness.
--
-- The Stripe direct-keys webhook receiver lives at
-- /api/webhooks/stripe/[clubId]; the URL embeds clubId so the receiver
-- can look up the right per-club whsec_… and verify the signature
-- against THAT club's secret. The same shape is used for Ziina and
-- N-Genius. The binding is correct only if every club configures a
-- DISTINCT webhook secret. A copy-paste mistake — one operator using
-- the same `whsec_…` for two clubs because they configured both clubs
-- inside one Stripe dashboard — defeats URL-binding: a Club-A webhook
-- landing on /stripe/<clubB-id> verifies against Club B's identical
-- secret, then fails downstream booking-resolution. Fail-closed, but
-- the operator gets no signal at config time.
--
-- This migration adds a `webhook_secret_hash` column on
-- `club_payment_accounts` (cleartext SHA-256 hex digest of the webhook
-- signing secret — hash leaking is harmless because the secret can't
-- be recovered from it) and a partial unique index that enforces a
-- single hash across the table. Old rows have NULL hash and the
-- partial predicate skips them; the next time a club re-connects the
-- adapter populates the hash. The connect path also pre-checks the
-- hash inside the upsert transaction so the user gets a 409 with a
-- clear error rather than a Postgres unique-violation surfacing as 500.

BEGIN;

ALTER TABLE "club_payment_accounts"
  ADD COLUMN IF NOT EXISTS "webhook_secret_hash" VARCHAR(64);

-- Partial UNIQUE: rows without a webhook secret stay NULL and don't
-- compete for the slot. A new connect that supplies a hash already
-- bound to another row fails with code 23505; the application layer
-- pre-checks for a clean 409 before the constraint fires (defense in
-- depth — the index handles the race window).
CREATE UNIQUE INDEX IF NOT EXISTS "club_payment_accounts_webhook_secret_hash_unique"
  ON "club_payment_accounts" ("webhook_secret_hash")
  WHERE "webhook_secret_hash" IS NOT NULL;

COMMIT;
