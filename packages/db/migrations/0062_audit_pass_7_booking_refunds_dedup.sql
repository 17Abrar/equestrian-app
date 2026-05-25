-- 0062_audit_pass_7_booking_refunds_dedup.sql
--
-- Audit pass-7 codex HIGH-1 (2026-05-25): refund double-count.
--
-- The admin refund route at
--   apps/web/app/api/v1/bookings/[bookingId]/refund/route.ts
-- calls `recordBookingRefund(amount)` synchronously after the adapter
-- successfully issues a refund. The matching provider webhook later
-- arrives with `event.refundAmountMinor = amount` and webhook-helpers
-- ALSO calls `recordBookingRefund(amount)`. The CAS in
-- `recordBookingRefund` (`packages/db/src/queries/bookings.ts:801-848`)
-- only protects CONCURRENT races on the booking row — it does NOT
-- prevent sequential same-delta applications. The comment at
-- `webhook-helpers.ts:525` claimed otherwise; that claim was wrong for
-- the explicit-delta refund branch (correct only for cumulative).
--
-- Real exposure: N-Genius `PARTIALLY_REFUNDED` events carry per-event
-- deltas. An admin partial refund + the matching webhook would
-- double-record. Cavaliq's books read 2x what the provider actually
-- refunded; the operator only finds out at month-end reconciliation.
--
-- Fix: idempotency by provider-side refund ID. A new `booking_refunds`
-- table records each (booking_id, provider_refund_id) pair we've
-- applied. A new `applyProviderRefund(...)` helper INSERTs the row
-- with ON CONFLICT DO NOTHING and only advances the booking ledger if
-- the row was inserted. Both call sites (admin route + webhook
-- explicit-delta path) pass the provider's refund ID, so the second
-- caller no-ops cleanly.
--
-- The cumulative path (`charge.refunded` with empty `refunds.data`)
-- does not use this table — that path is self-correcting because
-- `delta = max(0, cumulative_total - current_ledger)` returns 0 when
-- the admin route already applied the matching amount. Documented in
-- the helper comment.
--
-- Composite FK to bookings(id, club_id) — same pattern as every other
-- child table in the pass-3/4/5 composite-FK hardening. Without it, a
-- writer could insert a booking_refunds row whose (booking_id, club_id)
-- pair points at a booking in another club. ON DELETE CASCADE so
-- hard-deleting a booking (rare; only on tenant teardown) doesn't
-- leave orphan rows.

CREATE TABLE booking_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  provider payment_provider NOT NULL,
  provider_refund_id varchar(255) NOT NULL,
  amount_minor_units integer NOT NULL CHECK (amount_minor_units > 0),
  -- Marks the refund as later reversed by a `pending → failed` provider
  -- webhook (audit B-4). Not deleting the row preserves the dedup
  -- record so a duplicate succeeded-event for the same refund doesn't
  -- re-record after the reversal.
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_refunds_booking_provider_refund_unique
    UNIQUE (booking_id, provider_refund_id),
  CONSTRAINT booking_refunds_booking_club_fk
    FOREIGN KEY (booking_id, club_id)
    REFERENCES bookings(id, club_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_booking_refunds_club_booking ON booking_refunds (club_id, booking_id);
CREATE INDEX idx_booking_refunds_provider_refund ON booking_refunds (provider, provider_refund_id);
