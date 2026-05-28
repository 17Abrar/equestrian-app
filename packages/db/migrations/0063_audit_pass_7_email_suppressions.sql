-- 0063_audit_pass_7_email_suppressions.sql
--
-- Audit pass-7 integration followup ⑤ (2026-05-25): phase-2 of the
-- Resend webhook handler (PR #181). Phase 1 ingested bounce/complaint
-- events at log-only level so operators could see them; this migration
-- + the matching `sendEmail` check actually USE those events to stop
-- sending to bounced / complained addresses.
--
-- Schema design notes:
--   * `email` is UNIQUE — one suppression per address, globally. We
--     don't model per-club suppression because the practical effect
--     is the same: a bounced address bounces from every sender, and a
--     spam complaint at one club's hand contaminates the wider Resend
--     sender reputation that affects every other club too. If a future
--     case argues for per-club override, add a `club_id` column then.
--   * `email` capped at 320 chars per RFC 5321 (64 local + 1 @ + 255
--     domain). Postgres `text` would also work; varchar gives a clear
--     contract for the API layer.
--   * `retired_at` lets us "unsuppress" (e.g. user fixed their mailbox,
--     operator manually clears) without losing the historical signal.
--     `isSuppressed` filters `retired_at IS NULL`.
--   * `reason` distinguishes the source: `bounced` (hard delivery
--     failure), `complained` (spam mark), `manual` (operator add).
--     `email.failed` events do NOT auto-suppress — those are usually
--     transient or our-side errors, not recipient-side problems.
--   * `bounce_subtype` stores Resend's classification when present
--     (`hard` / `soft` / `undetermined`). Soft bounces are temporary
--     in theory but Resend's webhook still fires; we suppress on any
--     bounce delivery to keep `sendEmail` simple — operator can review.
--   * `source` carries the path that created the row (`resend_webhook`
--     vs `manual`) so a future suppressions admin UI can show
--     provenance.
--   * `notes` is for the manual case — operator adds a row with
--     "Customer asked for unsubscribe via WhatsApp 2026-05-22" etc.

CREATE TABLE email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL,
  reason varchar(20) NOT NULL CHECK (reason IN ('bounced', 'complained', 'manual')),
  bounce_subtype varchar(20),
  source varchar(20) NOT NULL CHECK (source IN ('resend_webhook', 'manual')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT email_suppressions_email_unique UNIQUE (email)
);

-- The hot path is `isSuppressed(email)` called once per email send.
-- The PK lookup via UNIQUE(email) already gives O(log n) — but it
-- returns the row even after retired. A partial index on the active
-- (non-retired) rows keeps the hot path index-only.
CREATE INDEX idx_email_suppressions_active
  ON email_suppressions (email)
  WHERE retired_at IS NULL;
