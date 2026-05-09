import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  subscriptionStatusEnum,
  subscriptionTierEnum,
  joinPolicyEnum,
} from './enums';

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
  horse_registration_submitted?: { email: boolean };
  horse_registration_approved?: { email: boolean };
  horse_registration_declined?: { email: boolean };
  livery_invoice_issued?: { email: boolean };
  livery_payment_received?: { email: boolean };
  livery_invoice_overdue?: { email: boolean };
  // Round 6.2 — horse care reminders (vaccination/farrier/dental due,
  // vet follow-ups, insurance expiry, medication end). One umbrella
  // toggle for all four kinds; the underlying cadence (7/1/0 for due
  // dates, 30/7/1 for insurance, 7/1 for medication end) is fixed in
  // the cron logic. Default-on; a club admin can flip it off in
  // Settings → Notifications when their workflow uses an external
  // calendar instead.
  horse_care_reminder?: { email: boolean };
}

export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  country: varchar('country', { length: 100 }),
  timezone: varchar('timezone', { length: 50 }).notNull().default('Asia/Dubai'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  logoUrl: text('logo_url'),
  coverPhotoUrl: text('cover_photo_url'),
  description: text('description'),
  websiteUrl: text('website_url'),
  socialInstagram: text('social_instagram'),
  socialFacebook: text('social_facebook'),
  socialTiktok: text('social_tiktok'),

  // Stripe
  stripeAccountId: varchar('stripe_account_id', { length: 255 }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),

  // Subscription. Audit AI-36 — tier promoted to pgEnum.
  subscriptionTier: subscriptionTierEnum('subscription_tier').notNull().default('trial'),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('trialing'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),

  // Audit pass-2 (2026-05-09 C-1): per-club dedup for the trial-ending
  // nudge cron. The previous implementation relied on the date check
  // `trial_ends_at::date = today + daysOut` for dedup — which works
  // until the cron's outer try fires a 5xx that worker-entry retries:
  // each retry within the same UTC day re-fires the nudge. CAS-guard
  // the send via these timestamp columns: `markTrialReminderSent` does
  // a `WHERE column IS NULL RETURNING …`; the second isolate observes
  // the first one's now() and bails. Migration 0053 adds the columns.
  trialReminder3DaySentAt: timestamp('trial_reminder_3day_sent_at', { withTimezone: true }),
  trialReminder1DaySentAt: timestamp('trial_reminder_1day_sent_at', { withTimezone: true }),

  // Booking settings
  advanceBookingDays: integer('advance_booking_days').notNull().default(30),
  bookingCutoffHours: integer('booking_cutoff_hours').notNull().default(2),
  cancellationNoticeHours: integer('cancellation_notice_hours').notNull().default(24),
  defaultLessonDurationMinutes: integer('default_lesson_duration_minutes').notNull().default(60),
  allowOverbooking: boolean('allow_overbooking').notNull().default(false),
  overbookingLimit: integer('overbooking_limit').notNull().default(0),
  defaultCalendarView: varchar('default_calendar_view', { length: 20 }).notNull().default('week'),
  lateCancellationFeePercent: numeric('late_cancellation_fee_percent', { precision: 5, scale: 2 })
    .notNull()
    .default('0'),
  noShowFeePercent: numeric('no_show_fee_percent', { precision: 5, scale: 2 })
    .notNull()
    .default('0'),

  // Branding (white-label)
  brandPrimaryColor: varchar('brand_primary_color', { length: 7 }).default('#6366f1'),
  brandSecondaryColor: varchar('brand_secondary_color', { length: 7 }).default('#ec4899'),
  faviconUrl: text('favicon_url'),

  // Notification preferences (per-event on/off flags, stored as jsonb)
  notificationPreferences: jsonb('notification_preferences')
    .$type<NotificationPreferences>()
    .notNull()
    .default({
      booking_confirmation: { email: true },
      booking_reminder_24h: { email: true },
      booking_cancellation: { email: true },
      payment_receipt: { email: true },
      payment_failed: { email: true },
      feed_alert: { email: true },
      waitlist_promotion: { email: true },
      rider_welcome: { email: true },
      invoice_issued: { email: true },
      horse_registration_submitted: { email: true },
      horse_registration_approved: { email: true },
      horse_registration_declined: { email: true },
      livery_invoice_issued: { email: true },
      livery_payment_received: { email: true },
      livery_invoice_overdue: { email: true },
      horse_care_reminder: { email: true },
    }),

  // Onboarding
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),

  // Public discovery (Round 7 — rider self-signup funnel). Audit AI-36 —
  // joinPolicy promoted to pgEnum.
  isPublicListing: boolean('is_public_listing').notNull().default(false),
  joinPolicy: joinPolicyEnum('join_policy').notNull().default('invite_only'),
  shortDescription: varchar('short_description', { length: 280 }),

  // Metadata
  clerkOrgId: varchar('clerk_org_id', { length: 255 }).unique(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // Audit F-39 (2026-05-07 r5): partial index from migration 0008
  // backing the public-listing rider funnel. The predicate filters out
  // both un-listed and soft-deleted clubs, keeping the index sized to
  // the live work-set. Without `.where(...)` here, `drizzle-kit
  // generate` would emit a DROP+CREATE-as-full migration.
  index('idx_clubs_public_listing')
    .on(table.isPublicListing)
    .where(sql`is_public_listing = true AND deleted_at IS NULL`),
]);

export type JoinPolicy = 'open' | 'approval' | 'invite_only';
