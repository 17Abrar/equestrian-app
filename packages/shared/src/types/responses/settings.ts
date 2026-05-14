/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated club-settings DTO.
 * Source-of-truth row: the `clubs` row + `club_settings` join in
 * `packages/db/src/queries/clubs.ts` (`getClubSettings`).
 *
 * Audit pass-10 F-10 (2026-05-14): `NotificationPreferences` deliberately
 * uses snake_case keys (the rest of this DTO is camelCase). The keys ARE
 * the persisted shape of the `clubs.notification_preferences` jsonb
 * column — see `packages/db/src/schema/clubs.ts:105-125`, where the
 * default row is baked in as `{ booking_confirmation: { email: true },
 * … }`. Email-trigger reads (`prefs.booking_confirmation?.email`) and
 * the seed/migration history all match this shape. Renaming to
 * camelCase would require a data migration to rewrite every existing
 * row plus coordinated updates to schema defaults and every reader; for
 * a cosmetic naming gain the cost/benefit doesn't justify the churn.
 * Future contributors: leave the snake_case as-is and consume the keys
 * exactly as written.
 */

export interface NotificationPreferences {
  booking_confirmation?: { email: boolean };
  booking_reminder_24h?: { email: boolean };
  booking_cancellation?: { email: boolean };
  payment_receipt?: { email: boolean };
  payment_failed?: { email: boolean };
  feed_alert?: { email: boolean };
  waitlist_promotion?: { email: boolean };
  rider_welcome?: { email: boolean };
  invoice_issued?: { email: boolean };
  // Round 8 — horse ownership flow
  horse_registration_submitted?: { email: boolean };
  horse_registration_approved?: { email: boolean };
  horse_registration_declined?: { email: boolean };
  // Round 8.5 — livery billing
  livery_invoice_issued?: { email: boolean };
  livery_payment_received?: { email: boolean };
  livery_invoice_overdue?: { email: boolean };
}

export interface ClubSettings {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  description: string | null;
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialFacebook: string | null;
  socialTiktok: string | null;
  advanceBookingDays: number;
  bookingCutoffHours: number;
  cancellationNoticeHours: number;
  defaultLessonDurationMinutes: number;
  allowOverbooking: boolean;
  overbookingLimit: number;
  defaultCalendarView: string;
  lateCancellationFeePercent: string;
  noShowFeePercent: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  faviconUrl: string | null;
  notificationPreferences: NotificationPreferences;
  isPublicListing: boolean;
  joinPolicy: string;
  shortDescription: string | null;
}
