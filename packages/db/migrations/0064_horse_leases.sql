-- 0064_horse_leases.sql
--
-- Horse leasing (user feature request 2026-05-27). Tracks half-lease
-- and full-lease arrangements between a horse and a lessee rider.
--
-- Business model:
--   * Half-lease: lessee pays half the monthly fee, has ~2-3 days/week
--     of access (not enforced in schema; club polices in practice).
--   * Full-lease: lessee pays the full monthly fee, has near-exclusive
--     access during the lease term.
--   * Lessee is a `club_members` row (rider/horse_owner role).
--   * Lease has start_date and end_date; both required so the cron
--     and reports can bound the active window without ambiguity.
--
-- Out of scope for this migration (queued as follow-ups):
--   * Billing integration — leases will be billed via a future
--     analogue of livery_invoices. For now the row exists and an
--     admin issues invoices outside the system.
--   * Booking permission — letting a lessee book "their" horse
--     specifically (rather than as any club rider). The existing
--     booking flow allows any rider to book any horse the club
--     surfaces, so the lease record is informational at first.
--
-- Schema design notes:
--   * Composite FK `(horse_id, club_id) -> horses(id, club_id)` and
--     `(lessee_member_id, club_id) -> club_members(id, club_id)` so
--     a cross-tenant row can't be inserted even via raw SQL. Mirrors
--     the audit-pass composite-FK convention (migrations 0017, 0019,
--     0033, 0038, 0040, 0041, 0042, 0043, 0044, 0047, 0048).
--   * `lease_type` and `status` are pgEnums (audit QA-36 — every
--     finite-domain string column gets a proper enum).
--   * `monthly_fee_minor` in minor currency units (fils/cents) for
--     parity with bookings/livery_invoices/expenses. `currency` is
--     varchar(3) ISO-4217 — application-side validation against
--     `SUPPORTED_CURRENCIES`.
--   * `CHECK (end_date >= start_date)` and
--     `CHECK (monthly_fee_minor >= 0)` enforced at the DB layer too
--     — the application Zod schema duplicates these but the DB check
--     catches a raw-SQL update path.
--   * `notes` is free text — rendered as plain text per the
--     2026-05-13 free-text policy (NO dangerouslySetInnerHTML; no
--     DOMPurify in the tree).
--
-- Indexes:
--   * `(club_id, status)` — dashboard "active leases" listing.
--   * `(horse_id, status)` — horse profile "current lease" lookup.
--   * `(lessee_member_id, status)` — rider portal "my leases".
--   * No partial-active index — the status enum is small (4 values),
--     a regular b-tree is fine.

CREATE TYPE "lease_type" AS ENUM ('half', 'full');
CREATE TYPE "lease_status" AS ENUM ('pending', 'active', 'ended', 'cancelled');

CREATE TABLE "horse_leases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "horse_id" uuid NOT NULL,
  "lessee_member_id" uuid NOT NULL,
  "lease_type" "lease_type" NOT NULL,
  "monthly_fee_minor" integer NOT NULL,
  "currency" varchar(3) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" "lease_status" NOT NULL DEFAULT 'pending',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "horse_leases_horse_club_fk"
    FOREIGN KEY ("horse_id", "club_id")
    REFERENCES "horses"("id", "club_id") ON DELETE CASCADE,
  CONSTRAINT "horse_leases_lessee_club_fk"
    FOREIGN KEY ("lessee_member_id", "club_id")
    REFERENCES "club_members"("id", "club_id"),
  CONSTRAINT "horse_leases_date_range_check"
    CHECK ("end_date" >= "start_date"),
  CONSTRAINT "horse_leases_monthly_fee_nonneg_check"
    CHECK ("monthly_fee_minor" >= 0)
);

CREATE INDEX "idx_horse_leases_club_status"
  ON "horse_leases" ("club_id", "status");
CREATE INDEX "idx_horse_leases_horse_status"
  ON "horse_leases" ("horse_id", "status");
CREATE INDEX "idx_horse_leases_lessee_status"
  ON "horse_leases" ("lessee_member_id", "status");
