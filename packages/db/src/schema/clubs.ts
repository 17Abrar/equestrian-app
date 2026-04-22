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
} from 'drizzle-orm/pg-core';
import { subscriptionStatusEnum } from './enums';

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

  // Subscription
  subscriptionTier: varchar('subscription_tier', { length: 20 }).notNull().default('trial'),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('trialing'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  platformFeePercent: numeric('platform_fee_percent', { precision: 4, scale: 2 })
    .notNull()
    .default('3.5'),

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
    }),

  // Onboarding
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),

  // Metadata
  clerkOrgId: varchar('clerk_org_id', { length: 255 }).unique(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
