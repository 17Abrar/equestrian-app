/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated club-settings DTO.
 * Source-of-truth row: the `clubs` row + `club_settings` join in
 * `packages/db/src/queries/clubs.ts` (`getClubSettings`).
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
