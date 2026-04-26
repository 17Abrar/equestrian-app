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
} from 'drizzle-orm/pg-core';
import { paymentStatusEnum, paymentMethodEnum } from './enums';
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
  arenaId: uuid('arena_id').references(() => arenas.id),
  disciplines: text('disciplines').array(),
  entryFee: integer('entry_fee'),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  registrationDeadline: timestamp('registration_deadline', { withTimezone: true }),
  maxParticipants: integer('max_participants'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_competitions_club').on(table.clubId),
  index('idx_competitions_date').on(table.clubId, table.startDate),
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
]);

export const competitionEntries = pgTable(
  'competition_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => competitionClasses.id, { onDelete: 'cascade' }),
    riderMemberId: uuid('rider_member_id')
      .notNull()
      .references(() => clubMembers.id),
    horseId: uuid('horse_id').references(() => horses.id),

    status: varchar('status', { length: 20 }).notNull().default('registered'),
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
  ],
);

export const competitionResults = pgTable('competition_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  entryId: uuid('entry_id')
    .notNull()
    .references(() => competitionEntries.id, { onDelete: 'cascade' }),

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
]);
