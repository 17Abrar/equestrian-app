import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  integer,
  boolean,
  numeric,
  timestamp,
  unique,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import {
  paymentStatusEnum,
  paymentMethodEnum,
  competitionStatusEnum,
  competitionEntryStatusEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { horses } from './horses';
import { arenas } from './bookings';

export const competitions = pgTable('competitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  location: text('location'),
  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite in table-extras below.
  arenaId: uuid('arena_id'),
  disciplines: text('disciplines').array(),
  entryFee: integer('entry_fee'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  registrationDeadline: timestamp('registration_deadline', { withTimezone: true }),
  maxParticipants: integer('max_participants'),
  // Audit AI-36 — promoted to pgEnum so the DB rejects unknown values.
  status: competitionStatusEnum('status').notNull().default('draft'),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_competitions_club').on(table.clubId),
  index('idx_competitions_date').on(table.clubId, table.startDate),
  foreignKey({
    name: 'competitions_arena_club_fk',
    columns: [table.arenaId, table.clubId],
    foreignColumns: [arenas.id, arenas.clubId],
  }),
]);

export const competitionClasses = pgTable('competition_classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  competitionId: uuid('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  discipline: varchar('discipline', { length: 100 }),
  level: varchar('level', { length: 100 }),
  maxEntries: integer('max_entries'),
  entryFee: integer('entry_fee'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_competition_classes_competition').on(table.competitionId),
  // FK target for composite (class_id, club_id) → competition_classes
  // (id, club_id) on competition_entries. Migration 0040.
  unique('competition_classes_id_club_unique').on(table.id, table.clubId),
]);

export const competitionEntries = pgTable(
  'competition_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit F-8 (2026-05-06 comprehensive): single-column FKs dropped in
    // migration 0040; replaced with composites in table-extras below.
    classId: uuid('class_id').notNull(),
    riderMemberId: uuid('rider_member_id').notNull(),
    // Audit MED (2026-05-06 third pass): inline single-column FK was
    // dropped in migration 0038 and replaced with the composite
    // (horse_id, club_id) → horses(id, club_id) ON DELETE SET NULL
    // declared in the table-extras below. `horse_id` is nullable so
    // the composite uses SET NULL — preserves the entry row when a
    // horse is later deleted.
    horseId: uuid('horse_id'),

    // Audit AI-36 — promoted to pgEnum.
    status: competitionEntryStatusEnum('status').notNull().default('registered'),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
    paymentMethod: paymentMethodEnum('payment_method'),
    amount: integer('amount'),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),

    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawalReason: text('withdrawal_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('competition_entries_class_rider_unique').on(table.classId, table.riderMemberId),
    index('idx_competition_entries_rider').on(table.riderMemberId),
    // FK target for composite (entry_id, club_id) → competition_entries
    // (id, club_id) on competition_results. Migration 0040.
    unique('competition_entries_id_club_unique').on(table.id, table.clubId),
    foreignKey({
      name: 'competition_entries_horse_club_fk',
      columns: [table.horseId, table.clubId],
      foreignColumns: [horses.id, horses.clubId],
    }).onDelete('set null'),
    foreignKey({
      name: 'competition_entries_class_club_fk',
      columns: [table.classId, table.clubId],
      foreignColumns: [competitionClasses.id, competitionClasses.clubId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'competition_entries_rider_member_club_fk',
      columns: [table.riderMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
  ],
);

export const competitionResults = pgTable('competition_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite in table-extras below
  // preserving ON DELETE CASCADE.
  entryId: uuid('entry_id').notNull(),

  placing: integer('placing'),
  timeSeconds: numeric('time_seconds', { precision: 10, scale: 3 }),
  faults: integer('faults').notNull().default(0),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // One result per entry. Without this, two judges submitting the same
  // entry race past the route-level entry-exists check and both INSERT,
  // producing duplicate rows that rank the same rider twice on the
  // leaderboard. See migration 0018.
  unique('competition_results_entry_unique').on(table.entryId),
  foreignKey({
    name: 'competition_results_entry_club_fk',
    columns: [table.entryId, table.clubId],
    foreignColumns: [competitionEntries.id, competitionEntries.clubId],
  }).onDelete('cascade'),
]);
