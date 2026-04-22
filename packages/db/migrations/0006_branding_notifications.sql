-- Branding columns for club white-labeling.
ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "brand_primary_color" varchar(7) DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS "brand_secondary_color" varchar(7) DEFAULT '#ec4899',
  ADD COLUMN IF NOT EXISTS "favicon_url" text;

-- Notification preferences stored as a jsonb blob keyed by event name. Each
-- event maps to { email: boolean } (SMS deferred). Defaults to all emails on
-- for legacy clubs; new clubs inherit the column default.
ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{
    "booking_confirmation": {"email": true},
    "booking_reminder_24h": {"email": true},
    "booking_cancellation": {"email": true},
    "payment_receipt": {"email": true},
    "payment_failed": {"email": true},
    "feed_alert": {"email": true},
    "waitlist_promotion": {"email": true},
    "rider_welcome": {"email": true},
    "invoice_issued": {"email": true}
  }'::jsonb;
