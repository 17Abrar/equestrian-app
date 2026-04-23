-- Round 8.5 — monthly livery billing for approved horse ownerships.
-- Structurally similar to the existing `invoices` table but scoped to a
-- single horse's livery cycle so the billing cron can reason about periods
-- independently of ad-hoc invoices.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'livery_invoice_status') THEN
    CREATE TYPE "livery_invoice_status" AS ENUM (
      'pending',
      'paid',
      'overdue',
      'cancelled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "livery_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
  "horse_id" uuid NOT NULL REFERENCES "horses"("id") ON DELETE CASCADE,
  "owner_member_id" uuid NOT NULL REFERENCES "club_members"("id"),
  "invoice_number" varchar(50) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "amount_minor_units" integer NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'AED',
  "status" "livery_invoice_status" NOT NULL DEFAULT 'pending',
  "due_date" date NOT NULL,
  "paid_at" timestamptz,
  "cancelled_at" timestamptz,
  "payment_provider" varchar(50),
  "provider_payment_id" varchar(255),
  "pay_link" text,
  "last_reminder_at" timestamptz,
  "reminder_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- One invoice per horse per period — idempotency for the cron, so a
  -- re-run on the same day can't double-issue.
  CONSTRAINT "livery_invoices_unique_horse_period"
    UNIQUE ("horse_id", "period_start")
);

CREATE INDEX IF NOT EXISTS "idx_livery_invoices_club"
  ON "livery_invoices" ("club_id");

CREATE INDEX IF NOT EXISTS "idx_livery_invoices_owner_status"
  ON "livery_invoices" ("owner_member_id", "status");

CREATE INDEX IF NOT EXISTS "idx_livery_invoices_horse"
  ON "livery_invoices" ("horse_id");

-- Used by the cron to find outstanding invoices for overdue reminders.
CREATE INDEX IF NOT EXISTS "idx_livery_invoices_status_due"
  ON "livery_invoices" ("status", "due_date")
  WHERE "status" IN ('pending', 'overdue');

-- Used by payment webhooks to match an incoming payment to its invoice.
CREATE INDEX IF NOT EXISTS "idx_livery_invoices_provider_payment"
  ON "livery_invoices" ("provider_payment_id")
  WHERE "provider_payment_id" IS NOT NULL;
