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
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  couponStatusEnum,
  couponDiscountTypeEnum,
  paymentStatusEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { bookings, lessonTypes } from './bookings';

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite (lesson_type_id, club_id) →
  // lesson_types(id, club_id) ON DELETE SET NULL in table-extras below.
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
  // FK target for composite (package_id, club_id) → packages(id, club_id)
  // on rider_packages. Migration 0040.
  unique('packages_id_club_unique').on(table.id, table.clubId),
  foreignKey({
    name: 'packages_lesson_type_club_fk',
    columns: [table.lessonTypeId, table.clubId],
    foreignColumns: [lessonTypes.id, lessonTypes.clubId],
  }).onDelete('set null'),
]);

export const riderPackages = pgTable('rider_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit F-8 (2026-05-06 comprehensive): single-column FKs dropped in
  // migration 0040; replaced with composites in table-extras below.
  packageId: uuid('package_id').notNull(),
  riderMemberId: uuid('rider_member_id').notNull(),

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
  // Audit F-4 / F-5 (2026-05-06 r3): FK target for composite
  // (package_id, club_id) → rider_packages(id, club_id) on bookings
  // and payments. Migration 0043.
  unique('rider_packages_id_club_unique').on(table.id, table.clubId),
  foreignKey({
    name: 'rider_packages_package_club_fk',
    columns: [table.packageId, table.clubId],
    foreignColumns: [packages.id, packages.clubId],
  }),
  foreignKey({
    name: 'rider_packages_rider_member_club_fk',
    columns: [table.riderMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
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
    // Units are tied to `discount_type` — see audit B-17:
    //   * percentage: integer 0–100 representing percent points (e.g. 33
    //     means 33% off; `validateCoupon` divides by 100 at compute time)
    //   * fixed: integer in minor currency units (fils for AED), applied
    //     directly as the deduction
    // `max_discount` (when set) caps the percentage path's output in the
    // same minor-unit units as `fixed`.
    discountValue: integer('discount_value').notNull(),
    maxDiscount: integer('max_discount'),
    // Audit pass-3 follow-up C (2026-05-09): the discount math above
    // is currency-agnostic. A 200-AED `fixed` coupon applied to a
    // USD lesson would silently treat it as 200-USD off (~4× over-
    // discount). `validateCoupon` now refuses to apply a coupon when
    // its currency doesn't match the booking's. New coupons default
    // to the club's currency at create time. Migration 0055
    // backfills existing rows from `clubs.currency`.
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
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

    // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
    // migration 0040; replaced with composite below.
    createdByMemberId: uuid('created_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('coupons_club_code_unique').on(table.clubId, table.code),
    index('idx_coupons_status').on(table.clubId, table.status),
    // FK target for composite (coupon_id, club_id) → coupons(id, club_id)
    // on coupon_usages. Migration 0040.
    unique('coupons_id_club_unique').on(table.id, table.clubId),
    foreignKey({
      name: 'coupons_created_by_member_club_fk',
      columns: [table.createdByMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 —
    // schema drift fix. Percentage discounts must be 1-100; fixed
    // discounts must be >= 1.
    check(
      'coupons_discount_value_bounds_check',
      sql`(${table.discountType} = 'percentage' AND ${table.discountValue} BETWEEN 1 AND 100) OR (${table.discountType} = 'fixed' AND ${table.discountValue} >= 1)`,
    ),
  ],
);

// Audit F-70 (2026-05-07 r4): write-once usage ledger. A coupon
// application is recorded once at booking time; refunds/voids leave
// the row in place so historical reporting stays accurate. No
// `updated_at` by design — `usedAt` is the lifecycle timestamp.
export const couponUsages = pgTable('coupon_usages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit F-8/F-13 (2026-05-06 comprehensive): single-column FKs dropped
  // in migration 0040; replaced with composites in table-extras below.
  // `bookingId` ON DELETE behavior tightened from NO ACTION to SET NULL
  // — preserves the usage ledger row when the linked booking is deleted.
  couponId: uuid('coupon_id').notNull(),
  riderMemberId: uuid('rider_member_id').notNull(),
  bookingId: uuid('booking_id'),

  originalAmount: integer('original_amount').notNull(),
  discountAmount: integer('discount_amount').notNull(),
  finalAmount: integer('final_amount').notNull(),
  bookingType: varchar('booking_type', { length: 50 }),

  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_coupon_usages_coupon').on(table.couponId),
  index('idx_coupon_usages_rider').on(table.couponId, table.riderMemberId),
  foreignKey({
    name: 'coupon_usages_coupon_club_fk',
    columns: [table.couponId, table.clubId],
    foreignColumns: [coupons.id, coupons.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'coupon_usages_rider_member_club_fk',
    columns: [table.riderMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
  foreignKey({
    name: 'coupon_usages_booking_club_fk',
    columns: [table.bookingId, table.clubId],
    foreignColumns: [bookings.id, bookings.clubId],
  }).onDelete('set null'),
]);
