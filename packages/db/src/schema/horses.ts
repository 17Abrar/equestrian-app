import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import {
  horseStatusEnum,
  skillLevelEnum,
  horseSaleStatusEnum,
  ownershipStatusEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';

export const horses = pgTable('horses', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  ownerMemberId: uuid('owner_member_id').references(() => clubMembers.id),

  // Basic info
  name: varchar('name', { length: 255 }).notNull(),
  barnName: varchar('barn_name', { length: 255 }),
  breed: varchar('breed', { length: 100 }),
  gender: varchar('gender', { length: 20 }),
  dateOfBirth: date('date_of_birth'),
  color: varchar('color', { length: 100 }),
  heightHands: numeric('height_hands', { precision: 4, scale: 1 }),
  weightKg: numeric('weight_kg', { precision: 6, scale: 1 }),
  markings: text('markings'),
  microchipNumber: varchar('microchip_number', { length: 100 }),
  passportNumber: varchar('passport_number', { length: 100 }),
  registrationNumber: varchar('registration_number', { length: 100 }),

  // Status and capabilities
  status: horseStatusEnum('status').notNull().default('available'),
  skillLevel: skillLevelEnum('skill_level').notNull().default('beginner'),
  temperament: text('temperament').array(),
  weightLimitKg: numeric('weight_limit_kg', { precision: 5, scale: 1 }),
  minRiderAge: integer('min_rider_age'),
  maxLessonsPerDay: integer('max_lessons_per_day').notNull().default(3),
  mandatoryRestDays: integer('mandatory_rest_days').notNull().default(1),

  // Value and sale
  saleStatus: horseSaleStatusEnum('sale_status').notNull().default('not_for_sale'),
  purchasePrice: integer('purchase_price'),
  currentValue: integer('current_value'),
  salePrice: integer('sale_price'),
  saleDate: date('sale_date'),
  buyerName: varchar('buyer_name', { length: 255 }),

  // Gear sizing
  saddleSize: varchar('saddle_size', { length: 50 }),
  girthSize: varchar('girth_size', { length: 50 }),
  bridleSize: varchar('bridle_size', { length: 50 }),
  bitType: varchar('bit_type', { length: 100 }),
  bitSize: varchar('bit_size', { length: 50 }),
  blanketSize: varchar('blanket_size', { length: 50 }),
  bootsSize: varchar('boots_size', { length: 50 }),
  gearNotes: text('gear_notes'),

  // Insurance
  insuranceProvider: varchar('insurance_provider', { length: 255 }),
  insurancePolicyNumber: varchar('insurance_policy_number', { length: 100 }),
  insuranceCoverage: text('insurance_coverage'),
  insuranceExpiry: date('insurance_expiry'),

  // Photos
  primaryPhotoUrl: text('primary_photo_url'),
  photoUrls: text('photo_urls').array(),

  // Ownership (Round 8). Separate from operational `status` — a pending
  // registration isn't available for lessons yet; an active ownership can
  // still have the horse "resting" or "injured".
  ownershipStatus: ownershipStatusEnum('ownership_status').notNull().default('active'),
  monthlyLiveryFeeMinor: integer('monthly_livery_fee_minor'),
  liveryStartDate: date('livery_start_date'),
  liveryEndDate: date('livery_end_date'),
  ownershipDeclineReason: text('ownership_decline_reason'),
  ownershipSubmittedAt: timestamp('ownership_submitted_at', { withTimezone: true }),

  // Metadata
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_horses_club').on(table.clubId),
  index('idx_horses_status').on(table.clubId, table.status),
  index('idx_horses_skill').on(table.clubId, table.skillLevel),
  index('idx_horses_owner').on(table.ownerMemberId),
  index('idx_horses_deleted').on(table.deletedAt),
  // FK target for composite (horse_id, club_id) -> horses(id, club_id) on
  // every horse sub-resource table. Tautologically unique because id is
  // the PK, but Postgres needs the explicit constraint to use the column
  // pair as an FK target. See migration 0017.
  unique('horses_id_club_unique').on(table.id, table.clubId),
]);
