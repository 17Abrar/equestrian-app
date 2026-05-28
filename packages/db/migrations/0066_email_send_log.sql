-- 0066_email_send_log.sql
--
-- Task #22 (2026-05-28): durable record of every email this club
-- attempted to send. Today the only audit surface is the Resend
-- dashboard (one global view across all tenants) plus log lines that
-- expire with Logflare retention. Admins regularly ask "did X actually
-- get the booking confirmation?" and we can't answer from inside the
-- product. A persistent send log lets the Emails page ship a
-- "Recently sent" tab that doesn't depend on third-party tooling.
--
-- Composite FK enforces (sender_member_id, club_id) atomically so a
-- log row can't claim a sender from another club. Unlike audit_log
-- (which declares club_id NULLABLE and uses ON DELETE SET NULL on
-- the composite), this table's club_id is NOT NULL — a SET NULL
-- action would try to null both columns and abort the cascade.
-- ON DELETE NO ACTION instead: codex P2 (2026-05-28). A hard-delete
-- of a club_members row is blocked; in practice the app only ever
-- deactivates members (is_active=false), and hard-delete only
-- happens transitively when the parent CLUB is deleted, at which
-- point the outer ON DELETE CASCADE on club_id removes this row
-- before the composite FK fires.
--
-- Field choices:
--   * `to_email`        — recipient address (already in audit_log via
--     resourceId for some events, but those are sparse; we need it
--     reliably here).
--   * `subject`         — varchar(255) matching the send-API cap.
--   * `audience_id`     — populated for broadcast sends so admins can
--     trace "which audience did this go to". FK with SET NULL so an
--     audience-delete doesn't break history.
--   * `trigger`         — for transactional sends ('booking_confirmed',
--     'livery_invoice_issued', etc.). Free-text since the set evolves.
--   * `source`          — 'manual_single' | 'manual_broadcast' |
--     'transactional' — coarse bucket for filtering.
--   * `status`          — 'queued' | 'sent' | 'failed' | 'suppressed'.
--     Logged BEFORE the Resend POST resolves (status='queued') and
--     UPDATEd to 'sent'/'failed' based on the result.
--   * `resend_id`       — Resend's email id, lets us cross-reference
--     to the Resend dashboard for bounce/complaint debugging.
--   * `error`           — short human-readable message on failure
--     (sanitized; we already do this for the API response).
--   * `created_at`      — when the send was attempted.
--
-- Retention: NOT pruned by this migration. A separate retention cron
-- can rotate rows older than 180 days when the table grows large
-- enough to matter.

CREATE TABLE email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  sender_member_id uuid,
  to_email varchar(320) NOT NULL,
  subject varchar(255) NOT NULL,
  audience_id uuid REFERENCES audiences(id) ON DELETE SET NULL,
  trigger varchar(64),
  source varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  resend_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_send_log_source_check
    CHECK (source IN ('manual_single', 'manual_broadcast', 'transactional')),
  CONSTRAINT email_send_log_status_check
    CHECK (status IN ('queued', 'sent', 'failed', 'suppressed')),
  CONSTRAINT email_send_log_sender_member_club_fk
    FOREIGN KEY (sender_member_id, club_id)
    REFERENCES club_members(id, club_id)
    ON DELETE NO ACTION
);

-- Listing UI: per-club, newest-first. Most admin queries look at the
-- last few days; a btree on (club_id, created_at DESC) keeps the LIMIT
-- index-only.
CREATE INDEX idx_email_send_log_club_recent
  ON email_send_log (club_id, created_at DESC);

-- Status-filtered queries (e.g. "show me the failed sends") use a
-- compound index with status as the leading key so the partial scan
-- doesn't need a heap fetch for typical 25-row page.
CREATE INDEX idx_email_send_log_club_status
  ON email_send_log (club_id, status, created_at DESC);
