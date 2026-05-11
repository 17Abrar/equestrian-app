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
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

export const arenas = pgTable(
  'arenas',
  {
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
  },
  (table) => [
    index('idx_arenas_club').on(table.clubId),
    // FK target for composite (arena_id, club_id) → arenas(id, club_id)
    // on booking_slots and competitions. Migration 0040.
    unique('arenas_id_club_unique').on(table.id, table.clubId),
  ],
);

export const arenaSchedules = pgTable(
  'arena_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit F-67 (2026-05-07 r4): inline single-column FK dropped in
    // migration 0045; replaced with composite below. Schema-completeness
    // — table currently has no consumers but the every-tenant-FK-is-
    // composite invariant applies uniformly.
    arenaId: uuid('arena_id').notNull(),

    dayOfWeek: integer('day_of_week').notNull(),
    openTime: time('open_time').notNull(),
    closeTime: time('close_time').notNull(),
    isMaintenance: boolean('is_maintenance').notNull().default(false),
    maintenanceNotes: text('maintenance_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_arena_schedules').on(table.arenaId, table.dayOfWeek),
    foreignKey({
      name: 'arena_schedules_arena_club_fk',
      columns: [table.arenaId, table.clubId],
      foreignColumns: [arenas.id, arenas.clubId],
    }).onDelete('cascade'),
  ],
);

export const lessonTypes = pgTable(
  'lesson_types',
  {
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
    // Audit F-5 (2026-05-06 r2): inline single-column FK dropped in
    // migration 0041; replaced with composite (arena_id, club_id) →
    // arenas(id, club_id) declared in table-extras below.
    arenaId: uuid('arena_id'),
    isActive: boolean('is_active').notNull().default(true),
    color: varchar('color', { length: 7 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lesson_types_club').on(table.clubId),
    // FK target for composite (lesson_type_id, club_id) → lesson_types
    // (id, club_id) on booking_slots and packages. Migration 0040.
    unique('lesson_types_id_club_unique').on(table.id, table.clubId),
    foreignKey({
      name: 'lesson_types_arena_club_fk',
      columns: [table.arenaId, table.clubId],
      foreignColumns: [arenas.id, arenas.clubId],
    }),
    // Audit F-28 (2026-05-08 r6): a misclick (`min=4, max=2`) silently
    // produces a lesson type that never matches any slot. Cheap DB-level
    // guard mirrors the Zod refine on `createLessonTypeSchema`.
    // Migration 0049.
    check('lesson_types_riders_minmax_check', sql`${table.minRiders} <= ${table.maxRiders}`),
  ],
);

export const bookingSlots = pgTable(
  'booking_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit F-8/F-13 (2026-05-06): inline single-column FKs dropped in
    // migration 0040; replaced with composites in table-extras below.
    lessonTypeId: uuid('lesson_type_id').notNull(),
    arenaId: uuid('arena_id'),
    coachMemberId: uuid('coach_member_id'),

    date: date('date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    maxRiders: integer('max_riders').notNull(),
    currentRiders: integer('current_riders').notNull().default(0),
    isCancelled: boolean('is_cancelled').notNull().default(false),
    cancellationReason: text('cancellation_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_slots_club_date').on(table.clubId, table.date),
    index('idx_slots_coach').on(table.coachMemberId, table.date),
    index('idx_slots_arena').on(table.arenaId, table.date),
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 — schema
    // drift fix.
    check(
      'booking_slots_current_riders_bounds_check',
      sql`${table.currentRiders} >= 0 AND ${table.currentRiders} <= ${table.maxRiders}`,
    ),
    // FK target for composite (slot_id, club_id) → booking_slots(id,
    // club_id) on bookings + waitlist. Migration 0040.
    unique('booking_slots_id_club_unique').on(table.id, table.clubId),
    foreignKey({
      name: 'booking_slots_lesson_type_club_fk',
      columns: [table.lessonTypeId, table.clubId],
      foreignColumns: [lessonTypes.id, lessonTypes.clubId],
    }),
    foreignKey({
      name: 'booking_slots_arena_club_fk',
      columns: [table.arenaId, table.clubId],
      foreignColumns: [arenas.id, arenas.clubId],
    }),
    foreignKey({
      name: 'booking_slots_coach_member_club_fk',
      columns: [table.coachMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit F-13 (2026-05-06): single-column FK dropped in migration
    // 0040; replaced with composite (slot_id, club_id) → booking_slots
    // (id, club_id) ON DELETE CASCADE in table-extras below — booking
    // is meaningless without its slot.
    slotId: uuid('slot_id').notNull(),
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
    // Audit F-8 (2026-05-06): single-column FK dropped in migration 0040;
    // replaced with composite (booked_by_member_id, club_id) → club_members
    // (id, club_id) in table-extras below. NO ACTION on delete (financial
    // record).
    bookedByMemberId: uuid('booked_by_member_id').notNull(),

    status: bookingStatusEnum('status').notNull().default('pending'),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
    paymentMethod: paymentMethodEnum('payment_method'),
    // Audit F-11 (2026-05-06 r2). All four monetary columns below are
    // in MINOR units (fils for AED — 100 fils = 1 AED). Display layer
    // divides by 100; provider adapters expect minor units. Only
    // `refundedAmountMinor` carries the suffix in its name; the other
    // three are minor-unit by codebase convention. Renaming would
    // touch every reference and is deferred until the project grows
    // enough that the convention isn't memorable. DO NOT divide by
    // 100 in queries that consume these — that's display-only.
    amount: integer('amount'),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    // Audit F-71 (2026-05-07 r4 — informational): `.notNull().default(0)` on
    // the TS side; SQL is `NOT NULL DEFAULT 0` after the migration-0028
    // backfill. Verified in sync — no drift. Migration 0014 originally
    // added the column nullable, 0028 tightened it; the schema mirrors
    // the post-tightening shape.
    discountAmount: integer('discount_amount').notNull().default(0),
    refundedAmountMinor: integer('refunded_amount_minor').notNull().default(0),
    // ON DELETE SET NULL (audit H-14). The booking's `discountAmount` snapshot
    // captures the financial impact at booking time, so losing the link to
    // an expired/archived coupon doesn't corrupt finance reporting; keeping
    // NO ACTION blocked operators from cleaning up old coupons entirely.
    //
    // Audit F-3 + F-4 (2026-05-06 r3): inline single-column FKs dropped
    // in migration 0043; replaced with composite (col, club_id) →
    // parent(id, club_id) ON DELETE SET NULL declared in table-extras
    // below. Defense-in-depth against any future writer that constructs
    // booking rows programmatically without going through the route's
    // tenant-scoped coupon/package validators.
    couponId: uuid('coupon_id'),
    packageId: uuid('package_id'),

    // Generic payment-provider reference. `paymentProvider` disambiguates which
    // adapter owns `providerPaymentId` (a Stripe PaymentIntent id, N-Genius
    // order reference, or Ziina payment-intent id).
    //
    // Audit F-3 (2026-05-07 r4): the partial index
    // `idx_bookings_provider_payment` (migration 0046) is `WHERE
    // provider_payment_id IS NOT NULL`. Drizzle has no partial-index
    // builder; the index lives at the SQL layer only and does NOT
    // appear in the table-extras below. Powers the webhook lookup
    // `findBookingByProviderPaymentId` on the hot payment path —
    // sister tables (payments, livery_invoices, platform_subscription
    // _invoices) all carry the parallel index.
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
    // Audit F-8 (2026-05-06): single-column FK dropped in migration 0040;
    // replaced with composite in table-extras below, preserving the prior
    // ON DELETE SET NULL semantics. Cancellations outlive the staff member
    // who issued them — the audit row carries the actor identity at the
    // time of action, the cancellation just loses its actor pointer.
    cancelledByMemberId: uuid('cancelled_by_member_id'),

    // Guest bookings — the signed-in rider (riderMemberId) is booking on behalf
    // of someone who isn't a member of the stable. Guest contact details are
    // required when `isGuestBooking` is true; a CHECK constraint enforces that
    // DB-side. A rider may book themselves AND multiple guests for the same
    // slot, but each guest (by email) can only be booked once per slot — see
    // the partial unique indexes `idx_bookings_unique_rider_slot` and
    // `idx_bookings_unique_guest_slot` (audit F-58: fixed reference) in
    // migration 0015 (`packages/db/migrations/0015_booking_guest_fields.sql:44-53`).
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
  },
  (table) => [
    index('idx_bookings_club').on(table.clubId),
    index('idx_bookings_rider').on(table.riderMemberId),
    index('idx_bookings_slot').on(table.slotId),
    index('idx_bookings_horse').on(table.horseId),
    index('idx_bookings_status').on(table.clubId, table.status),
    index('idx_bookings_date').on(table.clubId, table.createdAt),
    // Audit F-18 (2026-05-06 r2). DB-level CHECK that money columns
    // can't go negative. App layer enforces this on every write path,
    // but a direct DB write or a future bug that bypasses route
    // validation now bounces at the DB. Migration 0042.
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 — schema
    // drift fix. Refund total cannot exceed booking amount.
    check(
      'bookings_refund_le_amount_check',
      sql`${table.refundedAmountMinor} >= 0 AND ${table.refundedAmountMinor} <= COALESCE(${table.amount}, 0)`,
    ),
    check('bookings_amount_nonneg', sql`${table.amount} IS NULL OR ${table.amount} >= 0`),
    // Audit F-30 (2026-05-08 r6): defense-in-depth — a NULL `amount` on a
    // confirmed/completed booking is functionally a bug (refund cap
    // silently allows refundedAmountMinor=0; no-show fee becomes NaN).
    // The three statuses below are the legitimate null-amount carve-outs:
    // `pending` (mid-creation, before price snapshot lands), `cancelled`
    // (no-charge cancel), `no_show` (rider failed to attend; cancellation-
    // fee path can carry the charge separately). Migration 0049 adds the
    // SQL constraint and verifies historical data first.
    check(
      'bookings_amount_required_when_confirmed_check',
      sql`${table.amount} IS NOT NULL OR ${table.status} IN ('cancelled','pending','no_show')`,
    ),
    check('bookings_discount_nonneg', sql`${table.discountAmount} >= 0`),
    check(
      'bookings_cancellation_fee_nonneg',
      sql`${table.cancellationFee} IS NULL OR ${table.cancellationFee} >= 0`,
    ),
    check('bookings_refunded_minor_nonneg', sql`${table.refundedAmountMinor} >= 0`),
    // Audit F-9 (2026-05-08 r6): mirror migration 0015's CHECK so Drizzle
    // schema is the source of truth. Was previously SQL-only.
    check(
      'bookings_guest_contact_required_check',
      sql`${table.isGuestBooking} = false OR (${table.guestName} IS NOT NULL AND ${table.guestEmail} IS NOT NULL AND ${table.guestPhone} IS NOT NULL)`,
    ),
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
    // Audit F-13 (2026-05-06 comprehensive): composite (slot_id, club_id)
    // → booking_slots(id, club_id) ON DELETE CASCADE — a booking cannot
    // outlive the slot it occupies; tighter than the prior NO ACTION.
    // Migration 0040.
    foreignKey({
      name: 'bookings_slot_club_fk',
      columns: [table.slotId, table.clubId],
      foreignColumns: [bookingSlots.id, bookingSlots.clubId],
    }).onDelete('cascade'),
    // Audit F-8 (2026-05-06): bookedBy is the actor; preserves NO ACTION.
    foreignKey({
      name: 'bookings_booked_by_member_club_fk',
      columns: [table.bookedByMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    // Audit F-8 (2026-05-06): preserves SET NULL.
    foreignKey({
      name: 'bookings_cancelled_by_member_club_fk',
      columns: [table.cancelledByMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }).onDelete('set null'),
    // Audit F-3 + F-4 (2026-05-06 r3). Migration 0043.
    foreignKey({
      name: 'bookings_coupon_club_fk',
      columns: [table.couponId, table.clubId],
      foreignColumns: [coupons.id, coupons.clubId],
    }).onDelete('set null'),
    foreignKey({
      name: 'bookings_package_club_fk',
      columns: [table.packageId, table.clubId],
      foreignColumns: [riderPackages.id, riderPackages.clubId],
    }).onDelete('set null'),
    // Composite FK target for `payments.booking_id, club_id`. Tautologically
    // unique because `id` is the PK, but Postgres needs the explicit
    // constraint to use the column pair as an FK target. Matches the
    // `bookings_id_club_id_unique` constraint added in migration 0033.
    unique('bookings_id_club_id_unique').on(table.id, table.clubId),
    // Audit F-9 (2026-05-08 r6): SQL-only artifacts of migration 0015.
    // Drizzle has no partial-unique-index builder; the indexes below
    // exist at the SQL layer only and are NOT mirrored here as Drizzle
    // declarations. Documented at table-extras level so a future
    // contributor regenerating this schema for a new table sees the
    // invariant and doesn't unknowingly drop dedup defenses.
    //
    //   idx_bookings_unique_rider_slot
    //     UNIQUE (rider_member_id, slot_id)
    //     WHERE is_guest_booking = false AND status <> 'cancelled'
    //
    //   idx_bookings_unique_guest_slot
    //     UNIQUE (lower(guest_email), slot_id)
    //     WHERE is_guest_booking = true
    //       AND status <> 'cancelled'
    //       AND guest_email IS NOT NULL
    //
    // Mirrors the parallel comment for `idx_bookings_provider_payment`
    // above. `createBooking` (`packages/db/src/queries/bookings.ts`)
    // relies on these as the primary defense against double-booking
    // races; the atomic `currentRiders + 1` UPDATE is the secondary.
  ],
);

export const horsePairingHistory = pgTable(
  'horse_pairing_history',
  {
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
    // Audit F-35 (2026-05-07 r4): inline single-column FK dropped in
    // migration 0045; replaced with composite (booking_id, club_id) →
    // bookings(id, club_id) ON DELETE CASCADE in table-extras below.
    bookingId: uuid('booking_id').notNull(),

    rating: integer('rating'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pairing_horse_rider').on(table.horseId, table.riderMemberId),
    // Audit F-11 (2026-05-07 r4): SQL index from migration 0028 — schema
    // drift fix.
    index('idx_pairing_club_rider').on(table.clubId, table.riderMemberId),
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
    foreignKey({
      name: 'horse_pairing_history_booking_club_fk',
      columns: [table.bookingId, table.clubId],
      foreignColumns: [bookings.id, bookings.clubId],
    }).onDelete('cascade'),
  ],
);

// Audit F-70 (2026-05-07 r4): waitlist queue is append-only. A rider
// either consumes their slot (entry promoted to a booking) or expires
// out (status flip to 'expired'); both transitions write a NEW row in
// the booking flow rather than mutating this entry. Therefore no
// `updated_at` column. If a future flow needs in-place mutation (e.g.
// position bump), add `updated_at` here AND in SQL.
export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit F-13 (2026-05-06): single-column FK dropped in migration
    // 0040; replaced with composite (slot_id, club_id) → booking_slots
    // (id, club_id) ON DELETE CASCADE in table-extras below — waitlist
    // entry is meaningless without its slot.
    slotId: uuid('slot_id').notNull(),
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
    foreignKey({
      name: 'waitlist_slot_club_fk',
      columns: [table.slotId, table.clubId],
      foreignColumns: [bookingSlots.id, bookingSlots.clubId],
    }).onDelete('cascade'),
  ],
);
