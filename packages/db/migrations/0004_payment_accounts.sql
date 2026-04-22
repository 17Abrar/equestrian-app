CREATE TYPE "public"."payment_account_status" AS ENUM('pending', 'connected', 'disabled', 'error');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'n_genius', 'ziina');--> statement-breakpoint
CREATE TABLE "club_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"status" "payment_account_status" DEFAULT 'pending' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"external_account_id" varchar(255),
	"encrypted_credentials" text,
	"metadata" jsonb,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_payment_accounts_club_provider_unique" UNIQUE("club_id","provider")
);
--> statement-breakpoint
ALTER TABLE "club_payment_accounts" ADD CONSTRAINT "club_payment_accounts_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_accounts_club" ON "club_payment_accounts" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "idx_payment_accounts_active" ON "club_payment_accounts" USING btree ("club_id","is_active");--> statement-breakpoint
ALTER TABLE "club_payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "club_payment_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "club_payment_accounts"
  USING ("club_id" = current_setting('app.current_club_id', true)::uuid)
  WITH CHECK ("club_id" = current_setting('app.current_club_id', true)::uuid);