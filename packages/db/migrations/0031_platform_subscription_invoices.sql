-- 2026-05-04 — Round 6 platform billing.
--
-- Cavaliq → club subscription invoices. The daily cron issues these on
-- each club's monthly anniversary (anchored to `trial_ends_at`). Mirrors
-- `livery_invoices` shape: same status enum, same uniqueness pattern,
-- same provider-id columns. Distinct table because the parent FK is
-- `clubs` (not horses) and the `tier` column is platform-specific.
--
-- Idempotent: every CREATE uses `IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS "platform_subscription_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL,

  "invoice_number" varchar(50) NOT NULL,

  "tier" "subscription_tier" NOT NULL,
  "amount_minor_units" integer NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'AED',

  "period_start" date NOT NULL,
  "period_end" date NOT NULL,

  "status" "livery_invoice_status" NOT NULL DEFAULT 'pending',
  "due_date" date NOT NULL,
  "paid_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,

  "payment_provider" varchar(50),
  "provider_payment_id" varchar(255),
  "pay_link" text,

  "last_reminder_at" timestamp with time zone,
  "reminder_count" integer NOT NULL DEFAULT 0,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- FK with ON DELETE CASCADE — if a club row is hard-deleted, drag its
-- platform invoices with it (consistent with livery_invoices ↔ clubs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_subscription_invoices_club_id_clubs_id_fk'
  ) THEN
    ALTER TABLE "platform_subscription_invoices"
      ADD CONSTRAINT "platform_subscription_invoices_club_id_clubs_id_fk"
      FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- One invoice per (club, period_start) — concurrent cron passes lose on
-- the second one with onConflictDoNothing returning null.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscription_invoices_unique_club_period"
  ON "platform_subscription_invoices" ("club_id", "period_start");

-- Per-club invoice number uniqueness — backs the 23505 retry in
-- createPlatformInvoiceWithGeneratedNumber.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscription_invoices_club_number_unique"
  ON "platform_subscription_invoices" ("club_id", "invoice_number");

CREATE INDEX IF NOT EXISTS "idx_platform_invoices_club"
  ON "platform_subscription_invoices" ("club_id");

CREATE INDEX IF NOT EXISTS "idx_platform_invoices_status_due"
  ON "platform_subscription_invoices" ("status", "due_date");

CREATE INDEX IF NOT EXISTS "idx_platform_invoices_provider_payment"
  ON "platform_subscription_invoices" ("provider_payment_id");
