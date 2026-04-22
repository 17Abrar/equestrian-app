import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import {
  couponStatusEnum,
  couponDiscountTypeEnum,
  paymentStatusEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { bookings } from './bookings';

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  lessonTypeId: uuid('lesson_type_id'),
  totalCredits: integer('total_credits').notNull(),
  price: integer('price').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  validityDays: integer('validity_days').notNull().default(90),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_packages_club').on(table.clubId),
]);

export const riderPackages = pgTable('rider_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  packageId: uuid('package_id')
    .notNull()
    .references(() => packages.id),
  riderMemberId: uuid('rider_member_id')
    .notNull()
    .references(() => clubMembers.id),

  totalCredits: integer('total_credits').notNull(),
  usedCredits: integer('used_credits').notNull().default(0),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_rider_packages_rider').on(table.riderMemberId),
  index('idx_rider_packages_expiry').on(table.expiresAt),
]);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),

    code: varchar('code', { length: 50 }).notNull(),
    discountType: couponDiscountTypeEnum('discount_type').notNull(),
    discountValue: integer('discount_value').notNull(),
    maxDiscount: integer('max_discount'),
    applicableTypes: text('applicable_types').array(),
    minimumAmount: integer('minimum_amount'),
    maxUses: integer('max_uses'),
    maxUsesPerRider: integer('max_uses_per_rider'),
    usageCount: integer('usage_count').notNull().default(0),
    firstTimeOnly: boolean('first_time_only').notNull().default(false),
    isStackable: boolean('is_stackable').notNull().default(false),
    status: couponStatusEnum('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    createdByMemberId: uuid('created_by_member_id').references(() => clubMembers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('coupons_club_code_unique').on(table.clubId, table.code),
    index('idx_coupons_status').on(table.clubId, table.status),
  ],
);

export const couponUsages = pgTable('coupon_usages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  couponId: uuid('coupon_id')
    .notNull()
    .references(() => coupons.id, { onDelete: 'cascade' }),
  riderMemberId: uuid('rider_member_id')
    .notNull()
    .references(() => clubMembers.id),
  bookingId: uuid('booking_id').references(() => bookings.id),

  originalAmount: integer('original_amount').notNull(),
  discountAmount: integer('discount_amount').notNull(),
  finalAmount: integer('final_amount').notNull(),
  bookingType: varchar('booking_type', { length: 50 }),

  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_coupon_usages_coupon').on(table.couponId),
  index('idx_coupon_usages_rider').on(table.couponId, table.riderMemberId),
]);
