-- Audit F-5: invariant on actively-billed horses. The cron's billing path
-- expects `liveryStartDate <= today` for any horse it picks up, and the
-- selection key is `ownership_status='active' AND monthly_livery_fee_minor > 0`.
-- Without this CHECK, a partial-recovery edit could land a row in
-- (active, fee>0, NULL livery_start_date) and the cron would silently
-- skip it for the lifetime of the horse.
--
-- Scope: only horses with a positive livery fee. School horses (fee=0
-- or NULL) legitimately have no start_date; admin-created school horses
-- are always (active, fee=NULL, no start_date) and must remain valid.
ALTER TABLE "horses"
  DROP CONSTRAINT IF EXISTS "horses_active_requires_livery_start";
ALTER TABLE "horses"
  ADD CONSTRAINT "horses_active_requires_livery_start"
  CHECK (
    "ownership_status" <> 'active'
    OR COALESCE("monthly_livery_fee_minor", 0) = 0
    OR "livery_start_date" IS NOT NULL
  );

-- Audit F-6: clubs created before each notification trigger was added
-- have a `notification_preferences` JSONB that's missing the newer keys.
-- `isNotificationEnabled` already fails-OPEN (returns true on missing
-- key), so today's behaviour is correct, but flipping a trigger to
-- default-OFF later would silently ignore those legacy clubs. Backfill
-- defensively: merge the canonical default into every row, with the
-- existing JSONB taking precedence so admins who explicitly disabled a
-- trigger don't get re-enabled.
UPDATE "clubs"
SET "notification_preferences" = jsonb_build_object(
  'booking_confirmation', jsonb_build_object('email', true),
  'booking_reminder_24h', jsonb_build_object('email', true),
  'booking_cancellation', jsonb_build_object('email', true),
  'payment_receipt', jsonb_build_object('email', true),
  'payment_failed', jsonb_build_object('email', true),
  'feed_alert', jsonb_build_object('email', true),
  'waitlist_promotion', jsonb_build_object('email', true),
  'rider_welcome', jsonb_build_object('email', true),
  'invoice_issued', jsonb_build_object('email', true),
  'horse_registration_submitted', jsonb_build_object('email', true),
  'horse_registration_approved', jsonb_build_object('email', true),
  'horse_registration_declined', jsonb_build_object('email', true),
  'livery_invoice_issued', jsonb_build_object('email', true),
  'livery_payment_received', jsonb_build_object('email', true),
  'livery_invoice_overdue', jsonb_build_object('email', true)
) || COALESCE("notification_preferences", '{}'::jsonb)
WHERE "notification_preferences" IS NULL
   OR NOT (
       "notification_preferences" ? 'horse_registration_submitted'
       AND "notification_preferences" ? 'horse_registration_approved'
       AND "notification_preferences" ? 'horse_registration_declined'
       AND "notification_preferences" ? 'livery_invoice_issued'
       AND "notification_preferences" ? 'livery_payment_received'
       AND "notification_preferences" ? 'livery_invoice_overdue'
   );
