import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  time,
  integer,
  boolean,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import {
  bookingStatusEnum,
  paymentStatusEnum,
  paymentMethodEnum,
  skillLevelEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { horses } from './horses';
import { coupons, riderPackages } from './packages';

export const arenas = pgTable('arenas', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  capacity: integer('capacity'),
  surfaceType: varchar('surface_type', { length: 100 }),
  hasLighting: boolean('has_lighting').notNull().default(false),
  isIndoor: boolean('is_indoor').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const arenaSchedules = pgTable('arena_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  arenaId: uuid('arena_id')
    .notNull()
    .references(() => arenas.id, { onDelete: 'cascade' }),

  dayOfWeek: integer('day_of_week').notNull(),
  openTime: time('open_time').notNull(),
  closeTime: time('close_time').notNull(),
  isMaintenance: boolean('is_maintenance').notNull().default(false),
  maintenanceNotes: text('maintenance_notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lessonTypes = pgTable('lesson_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  price: integer('price').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  maxRiders: integer('max_riders').notNull().default(1),
  minRiders: integer('min_riders').notNull().default(1),
  maxSessionsPerDay: integer('max_sessions_per_day'),
  arenaId: uuid('arena_id').references(() => arenas.id),
  isActive: boolean('is_active').notNull().default(true),
  color: varchar('color', { length: 7 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookingSlots = pgTable('booking_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  lessonTypeId: uuid('lesson_type_id')
    .notNull()
    .references(() => lessonTypes.id),
  arenaId: uuid('arena_id').references(() => arenas.id),
  coachMemberId: uuid('coach_member_id').references(() => clubMembers.id),

  date: date('date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  maxRiders: integer('max_riders').notNull(),
  currentRiders: integer('current_riders').notNull().default(0),
  isCancelled: boolean('is_cancelled').notNull().default(false),
  cancellationReason: text('cancellation_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  slotId: uuid('slot_id')
    .notNull()
    .references(() => bookingSlots.id),
  riderMemberId: uuid('rider_member_id')
    .notNull()
    .references(() => clubMembers.id),
  horseId: uuid('horse_id').references(() => horses.id),
  bookedByMemberId: uuid('booked_by_member_id')
    .notNull()
    .references(() => clubMembers.id),

  status: bookingStatusEnum('status').notNull().default('pending'),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
  paymentMethod: paymentMethodEnum('payment_method'),
  amount: integer('amount'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  discountAmount: integer('discount_amount').default(0),
  couponId: uuid('coupon_id').references(() => coupons.id),
  packageId: uuid('package_id').references(() => riderPackages.id),

  // Stripe
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

  // Check-in
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  qrCode: varchar('qr_code', { length: 100 }),

  // Coach notes
  coachNotes: text('coach_notes'),
  riderSkillAssessment: skillLevelEnum('rider_skill_assessment'),

  // Smart match
  horseMatchScore: integer('horse_match_score'),
  horseMatchAuto: boolean('horse_match_auto').notNull().default(true),

  cancellationReason: text('cancellation_reason'),
  cancellationFee: integer('cancellation_fee').default(0),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByMemberId: uuid('cancelled_by_member_id').references(() => clubMembers.id),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const horsePairingHistory = pgTable('horse_pairing_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),
  riderMemberId: uuid('rider_member_id')
    .notNull()
    .references(() => clubMembers.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),

  rating: integer('rating'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => bookingSlots.id),
    riderMemberId: uuid('rider_member_id')
      .notNull()
      .references(() => clubMembers.id),

    position: integer('position').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('waiting'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('waitlist_slot_rider_unique').on(table.slotId, table.riderMemberId)],
);
