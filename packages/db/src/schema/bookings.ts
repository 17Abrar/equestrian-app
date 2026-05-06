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
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import {
  bookingStatusEnum,
  paymentStatusEnum,
  paymentMethodEnum,
  skillLevelEnum,
  paymentProviderEnum,
  waitlistStatusEnum,
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
}, (table) => [
  index('idx_arenas_club').on(table.clubId),
]);

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
}, (table) => [
  index('idx_arena_schedules').on(table.arenaId, table.dayOfWeek),
]);

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
}, (table) => [
  index('idx_lesson_types_club').on(table.clubId),
]);

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
}, (table) => [
  index('idx_slots_club_date').on(table.clubId, table.date),
  index('idx_slots_coach').on(table.coachMemberId, table.date),
  index('idx_slots_arena').on(table.arenaId, table.date),
]);

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  slotId: uuid('slot_id')
    .notNull()
    .references(() => bookingSlots.id),
  // Audit MED (2026-05-06 third pass): inline single-column FK was
  // dropped in migration 0038 and replaced with the composite
  // (rider_member_id, club_id) → club_members(id, club_id) declared in
  // the table-extras below. ON DELETE NO ACTION (no clause) because
  // bookings are historical financial records — a member deletion has
  // to cascade through (or detach) bookings explicitly via app-layer
  // logic, never silently lose the rider linkage.
  riderMemberId: uuid('rider_member_id').notNull(),
  // Audit AI-22 (2026-05-05 pass 2): composite FK declared in the
  // table-extras below as `bookings_horse_club_fk` (horseId, clubId)
  // -> horses(id, clubId) ON DELETE SET NULL — matches migration 0033.
  // The single-column inline `references(() => horses.id)` was a
  // residual from before 0033 and would silently regenerate as a
  // regression migration if drizzle-kit ever ran `generate`.
  horseId: uuid('horse_id'),
  bookedByMemberId: uuid('booked_by_member_id')
    .notNull()
    .references(() => clubMembers.id),

  status: bookingStatusEnum('status').notNull().default('pending'),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
  paymentMethod: paymentMethodEnum('payment_method'),
  amount: integer('amount'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  discountAmount: integer('discount_amount').notNull().default(0),
  refundedAmountMinor: integer('refunded_amount_minor').notNull().default(0),
  // ON DELETE SET NULL (audit H-14). The booking's `discountAmount` snapshot
  // captures the financial impact at booking time, so losing the link to
  // an expired/archived coupon doesn't corrupt finance reporting; keeping
  // NO ACTION blocked operators from cleaning up old coupons entirely.
  couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  packageId: uuid('package_id').references(() => riderPackages.id, { onDelete: 'set null' }),

  // Generic payment-provider reference. `paymentProvider` disambiguates which
  // adapter owns `providerPaymentId` (a Stripe PaymentIntent id, N-Genius
  // order reference, or Ziina payment-intent id).
  paymentProvider: paymentProviderEnum('payment_provider'),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }),

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
  // ON DELETE SET NULL matches the SQL constraint
  // `bookings_cancelled_by_member_id_club_members_id_fk` (audit AI-22
  // pass 2). Cancellations should outlive the staff member who issued
  // them — the audit row carries the actor identity at the time of
  // action, the cancellation just loses its actor pointer.
  cancelledByMemberId: uuid('cancelled_by_member_id').references(
    () => clubMembers.id,
    { onDelete: 'set null' },
  ),

  // Guest bookings — the signed-in rider (riderMemberId) is booking on behalf
  // of someone who isn't a member of the stable. Guest contact details are
  // required when `isGuestBooking` is true; a CHECK constraint enforces that
  // DB-side. A rider may book themselves AND multiple guests for the same
  // slot, but each guest (by email) can only be booked once per slot — see
  // the partial unique indexes `idx_bookings_unique_rider_slot` and
  // `idx_bookings_unique_guest_slot` in migration 0009.
  isGuestBooking: boolean('is_guest_booking').notNull().default(false),
  guestName: varchar('guest_name', { length: 255 }),
  guestEmail: varchar('guest_email', { length: 255 }),
  guestPhone: varchar('guest_phone', { length: 50 }),
  guestSkillLevel: varchar('guest_skill_level', { length: 20 }),

  // Round 6.1 — set by `/api/cron/booking-reminders` once the 24h-before
  // reminder email goes out. The cron's mark-sent helper does a CAS on
  // `IS NULL` so concurrent invocations can't double-send. Migration 0036.
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_bookings_club').on(table.clubId),
  index('idx_bookings_rider').on(table.riderMemberId),
  index('idx_bookings_slot').on(table.slotId),
  index('idx_bookings_horse').on(table.horseId),
  index('idx_bookings_status').on(table.clubId, table.status),
  index('idx_bookings_date').on(table.clubId, table.createdAt),
  // Round 6.1 — supports the booking-reminder cron's "find upcoming
  // confirmed bookings that haven't been reminded yet" query. Composite
  // (slot_id, reminder_sent_at) lets a single index scan answer the
  // hot path. Migration 0036.
  index('idx_bookings_slot_reminder').on(table.slotId, table.reminderSentAt),
  // Composite FK ensures `horseId` matches the booking's `clubId` —
  // closes the cross-tenant smuggling surface a single-column FK
  // leaves open. ON DELETE SET NULL preserves the booking row when a
  // horse is deleted (the booking's `amount` snapshot stays correct
  // for finance reporting). Matches migration 0033.
  foreignKey({
    name: 'bookings_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('set null'),
  // Audit MED (2026-05-06 third pass): composite FK ensures
  // `riderMemberId` always matches the booking's own `clubId` — a
  // future writer that bypasses the route-level `getMemberById(ctx
  // .clubId, …)` precheck cannot smuggle a foreign-tenant member id
  // in. NO ACTION on delete (no clause) because bookings are
  // historical financial records that must outlive the member row.
  // Migration 0038.
  foreignKey({
    name: 'bookings_rider_member_club_fk',
    columns: [table.riderMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
  // Composite FK target for `payments.booking_id, club_id`. Tautologically
  // unique because `id` is the PK, but Postgres needs the explicit
  // constraint to use the column pair as an FK target. Matches the
  // `bookings_id_club_id_unique` constraint added in migration 0033.
  unique('bookings_id_club_id_unique').on(table.id, table.clubId),
]);

export const horsePairingHistory = pgTable('horse_pairing_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit MED (2026-05-06 third pass — adjacent-table follow-up):
  // inline single-column FKs were dropped in migration 0039 and
  // replaced with composite (col, club_id) → parent(id, club_id) FKs
  // declared in the table-extras below. Both composites preserve the
  // existing ON DELETE CASCADE semantics — a pairing record is
  // meaningless without the horse + rider it pairs.
  horseId: uuid('horse_id').notNull(),
  riderMemberId: uuid('rider_member_id').notNull(),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),

  rating: integer('rating'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_pairing_horse_rider').on(table.horseId, table.riderMemberId),
  foreignKey({
    name: 'horse_pairing_history_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'horse_pairing_history_rider_member_club_fk',
    columns: [table.riderMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }).onDelete('cascade'),
]);

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
    // Audit MED (2026-05-06 third pass — adjacent-table follow-up):
    // inline single-column FK was dropped in migration 0039 and
    // replaced with the composite (rider_member_id, club_id) →
    // club_members(id, club_id) declared in the table-extras below.
    // ON DELETE NO ACTION preserved — a member deletion is blocked
    // at the DB layer if waitlist entries remain, forcing operators
    // to clear the waitlist explicitly through the application path.
    riderMemberId: uuid('rider_member_id').notNull(),

    position: integer('position').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Audit AI-36 — promoted to pgEnum.
    status: waitlistStatusEnum('status').notNull().default('waiting'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('waitlist_slot_rider_unique').on(table.slotId, table.riderMemberId),
    index('idx_waitlist_slot').on(table.slotId, table.position),
    foreignKey({
      name: 'waitlist_rider_member_club_fk',
      columns: [table.riderMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
  ],
);
