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
} from 'drizzle-orm/pg-core';
import { fileCategoryEnum } from './enums';
import { clubs } from './clubs';
import { horses } from './horses';
import { clubMembers } from './club-members';

export const horseHealthRecords = pgTable('horse_health_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

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

  createdByMemberId: uuid('created_by_member_id').references(() => clubMembers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const horseMedications = pgTable('horse_medications', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

  medicationName: varchar('medication_name', { length: 255 }).notNull(),
  dosage: varchar('dosage', { length: 100 }).notNull(),
  frequency: varchar('frequency', { length: 100 }).notNull(),
  timeOfDay: text('time_of_day').array(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  prescribedBy: varchar('prescribed_by', { length: 255 }),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const horseMedicationLogs = pgTable('horse_medication_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  medicationId: uuid('medication_id')
    .notNull()
    .references(() => horseMedications.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

  administeredAt: timestamp('administered_at', { withTimezone: true }).notNull(),
  administeredByMemberId: uuid('administered_by_member_id').references(() => clubMembers.id),
  wasAdministered: boolean('was_administered').notNull().default(true),
  skipReason: text('skip_reason'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const horseFeedingPlans = pgTable('horse_feeding_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

  mealName: varchar('meal_name', { length: 100 }).notNull(),
  feedType: varchar('feed_type', { length: 255 }),
  quantityKg: numeric('quantity_kg', { precision: 5, scale: 2 }),
  supplements: text('supplements').array(),
  notes: text('notes'),
  timeOfDay: time('time_of_day'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
});

export const horseExerciseSchedules = pgTable('horse_exercise_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

  dayOfWeek: integer('day_of_week').notNull(),
  exerciseType: varchar('exercise_type', { length: 100 }).notNull(),
  durationMinutes: integer('duration_minutes'),
  intensity: varchar('intensity', { length: 20 }),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const horseDocuments = pgTable('horse_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id, { onDelete: 'cascade' }),

  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSizeBytes: integer('file_size_bytes'),
  fileType: varchar('file_type', { length: 50 }),
  category: fileCategoryEnum('category').notNull().default('other'),
  description: text('description'),
  uploadedByMemberId: uuid('uploaded_by_member_id').references(() => clubMembers.id),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
