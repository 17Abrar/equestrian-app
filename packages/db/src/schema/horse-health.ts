import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  integer,
  boolean,
  timestamp,
  time,
  numeric,
  index,
  foreignKey,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fileCategoryEnum } from './enums';
import { clubs } from './clubs';
import { horses } from './horses';
import { clubMembers } from './club-members';

export const horseHealthRecords = pgTable('horse_health_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // FK is composite (horse_id, club_id) -> horses(id, club_id), declared
  // below. Replaces the pre-0017 single-column FK so the DB rejects
  // mismatched-tenant inserts.
  horseId: uuid('horse_id').notNull(),

  recordType: varchar('record_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  date: date('date').notNull(),
  nextDueDate: date('next_due_date'),
  vetName: varchar('vet_name', { length: 255 }),
  vetClinic: varchar('vet_clinic', { length: 255 }),
  diagnosis: text('diagnosis'),
  treatment: text('treatment'),
  cost: integer('cost'),
  recoveryTimeDays: integer('recovery_time_days'),
  followUpNeeded: boolean('follow_up_needed').notNull().default(false),
  followUpDate: date('follow_up_date'),
  batchNumber: varchar('batch_number', { length: 100 }),
  productUsed: varchar('product_used', { length: 255 }),
  documentUrls: text('document_urls').array(),

  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite in table-extras below.
  createdByMemberId: uuid('created_by_member_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_health_records_club').on(table.clubId),
  index('idx_health_records_horse').on(table.horseId),
  index('idx_health_records_type').on(table.horseId, table.recordType),
  index('idx_health_records_next_due').on(table.nextDueDate),
  foreignKey({
    name: 'horse_health_records_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'horse_health_records_created_by_member_club_fk',
    columns: [table.createdByMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
]);

export const horseMedications = pgTable('horse_medications', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id').notNull(),

  medicationName: varchar('medication_name', { length: 255 }).notNull(),
  dosage: varchar('dosage', { length: 100 }).notNull(),
  frequency: varchar('frequency', { length: 100 }).notNull(),
  timeOfDay: text('time_of_day').array(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  // Audit pass-2 (2026-05-09): widened to text + encrypted. The
  // treating provider's name is HIPAA-style identifying info; encrypts
  // alongside `notes` via `MEDICATION_ENCRYPTED_FIELDS` in horse-
  // health.ts queries. Migration 0052 + verifier 0053 + backfill
  // script `scripts/backfill-pass-2-phi.mjs`.
  prescribedBy: text('prescribed_by'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_medications_horse').on(table.horseId),
  index('idx_medications_active').on(table.horseId, table.isActive),
  // FK target for composite (medication_id, club_id) → horse_medications
  // (id, club_id) on horse_medication_logs. Migration 0040.
  unique('horse_medications_id_club_unique').on(table.id, table.clubId),
  foreignKey({
    name: 'horse_medications_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
  // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 —
  // schema drift fix. End date (when set) must be on or after start.
  check(
    'horse_medications_date_range_check',
    sql`${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`,
  ),
]);

// Audit F-70 (2026-05-07 r4): write-once medication-administration ledger.
// A miss/skip is a separate row (not an update of the previous row), so
// the row is never mutated after insert. No `updated_at` by design.
export const horseMedicationLogs = pgTable('horse_medication_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite in table-extras below
  // preserving ON DELETE CASCADE.
  medicationId: uuid('medication_id').notNull(),
  horseId: uuid('horse_id').notNull(),

  administeredAt: timestamp('administered_at', { withTimezone: true }).notNull(),
  administeredByMemberId: uuid('administered_by_member_id'),
  wasAdministered: boolean('was_administered').notNull().default(true),
  skipReason: text('skip_reason'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_med_logs_medication').on(table.medicationId),
  index('idx_med_logs_date').on(table.administeredAt),
  foreignKey({
    name: 'horse_medication_logs_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'horse_medication_logs_medication_club_fk',
    columns: [table.medicationId, table.clubId],
    foreignColumns: [horseMedications.id, horseMedications.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'horse_medication_logs_administered_by_member_club_fk',
    columns: [table.administeredByMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
]);

export const horseFeedingPlans = pgTable('horse_feeding_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id').notNull(),

  mealName: varchar('meal_name', { length: 100 }).notNull(),
  feedType: varchar('feed_type', { length: 255 }),
  quantityKg: numeric('quantity_kg', { precision: 5, scale: 2 }),
  supplements: text('supplements').array(),
  notes: text('notes'),
  timeOfDay: time('time_of_day'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_feeding_plans_horse').on(table.horseId),
  foreignKey({
    name: 'horse_feeding_plans_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
]);

export const horseFeedTracker = pgTable('horse_feed_tracker', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  feedType: varchar('feed_type', { length: 255 }).notNull(),
  totalKg: numeric('total_kg', { precision: 8, scale: 2 }).notNull(),
  horsesEatingCount: integer('horses_eating_count').notNull(),
  dailyConsumptionKg: numeric('daily_consumption_kg', { precision: 6, scale: 2 }).notNull(),
  purchasedAt: date('purchased_at').notNull(),
  estimatedEmptyDate: date('estimated_empty_date').notNull(),
  alertSent: boolean('alert_sent').notNull().default(false),
  cost: integer('cost'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_feed_tracker_club').on(table.clubId),
  index('idx_feed_tracker_empty').on(table.estimatedEmptyDate),
]);

export const horseExerciseSchedules = pgTable('horse_exercise_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id').notNull(),

  dayOfWeek: integer('day_of_week').notNull(),
  exerciseType: varchar('exercise_type', { length: 100 }).notNull(),
  durationMinutes: integer('duration_minutes'),
  intensity: varchar('intensity', { length: 20 }),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_exercise_horse').on(table.horseId),
  foreignKey({
    name: 'horse_exercise_schedules_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
]);

/**
 * Round 6.2 — horse care reminders dedup table. The cron at
 * `/api/cron/horse-care-reminders` writes one row each time an email
 * lands for a particular (club, kind, source row, threshold) tuple.
 * The unique constraint blocks double-sends; the row stays forever as
 * an audit trail. Migration 0037.
 *
 * `kind` discriminates which underlying source the `source_id` points
 * at:
 *   - 'horse_health_record_due'      → horse_health_records.id (next_due_date)
 *   - 'horse_health_record_followup' → horse_health_records.id (follow_up_date)
 *   - 'horse_insurance'              → horses.id (insurance_expiry)
 *   - 'horse_medication_end'         → horse_medications.id (end_date)
 *
 * Not declared as an enum because future reminder kinds will be added
 * incrementally without a migration; the cron is the source of truth
 * for which kinds it actually emits.
 *
 * Audit F-70 (2026-05-07 r4): write-once dedup ledger. `sentAt` is the
 * lifecycle timestamp; the row is never updated after insert (a re-send
 * would be a separate row, blocked by the unique constraint). No
 * `updated_at` column by design.
 */
export const horseCareReminderSends = pgTable(
  'horse_care_reminder_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 50 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    thresholdDays: integer('threshold_days').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Audit F-37 (2026-05-07 r4): mirror SQL DESC on sent_at column —
    // matches migration 0037 exactly so drizzle-kit generate doesn't
    // emit a recreate-without-DESC migration.
    index('idx_horse_care_reminder_sends_club').on(
      table.clubId,
      sql`${table.sentAt} DESC`,
    ),
    unique('horse_care_reminder_sends_unique').on(
      table.clubId,
      table.kind,
      table.sourceId,
      table.thresholdDays,
    ),
  ],
);

/**
 * Audit F-64 (2026-05-07 r5): write-once horse-document table. A
 * document upload is the file's permanent record — the row is never
 * mutated after insert. To "rename" a file the consumer uploads a new
 * row and deletes the old one (or revokes the old fileUrl in R2);
 * to "edit" the description the consumer creates a new row and
 * deletes the old one. There is intentionally no `updated_at` column —
 * matches the same justification carried by `horse_medication_logs`
 * and `horse_care_reminder_sends` above. The CLAUDE.md "every table
 * carries created_at + updated_at" rule has an explicit carve-out for
 * write-once tables; this is one of them.
 */
export const horseDocuments = pgTable('horse_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id').notNull(),

  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSizeBytes: integer('file_size_bytes'),
  fileType: varchar('file_type', { length: 50 }),
  category: fileCategoryEnum('category').notNull().default('other'),
  description: text('description'),
  // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
  // migration 0040; replaced with composite below.
  uploadedByMemberId: uuid('uploaded_by_member_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_documents_horse').on(table.horseId),
  index('idx_documents_category').on(table.horseId, table.category),
  foreignKey({
    name: 'horse_documents_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'horse_documents_uploaded_by_member_club_fk',
    columns: [table.uploadedByMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
]);
