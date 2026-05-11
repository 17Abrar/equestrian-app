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
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  // Audit F-1 (2026-05-06 comprehensive audit): inline single-column FK
  // dropped in migration 0040; replaced with the composite
  // (owner_member_id, club_id) → club_members(id, club_id) declared in
  // table-extras below. ON DELETE NO ACTION (no clause): a member's
  // departure must explicitly handle horse-ownership transfer rather
  // than silently nulling the link.
  ownerMemberId: uuid('owner_member_id'),

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
  // Audit F-39 (2026-05-07 r5): two partial indexes from migration 0009.
  // Without these `.where(...)` declarations, `drizzle-kit generate`
  // would emit DROP+CREATE-as-full migrations and silently strip the
  // predicates, forcing the admin Pending Approvals tab to a full table
  // scan.
  index('idx_horses_ownership_pending')
    .on(table.clubId, sql`${table.ownershipSubmittedAt} DESC`)
    .where(sql`ownership_status = 'pending' AND deleted_at IS NULL`),
  index('idx_horses_owner_status')
    .on(table.ownerMemberId, table.ownershipStatus)
    .where(sql`owner_member_id IS NOT NULL AND deleted_at IS NULL`),
  index('idx_horses_livery_billing_due')
    .on(sql`${table.liveryStartDate} DESC`)
    .where(sql`ownership_status = 'active' AND COALESCE(monthly_livery_fee_minor, 0) > 0 AND deleted_at IS NULL`),
  // FK target for composite (horse_id, club_id) -> horses(id, club_id) on
  // every horse sub-resource table. Tautologically unique because id is
  // the PK, but Postgres needs the explicit constraint to use the column
  // pair as an FK target. See migration 0017.
  unique('horses_id_club_unique').on(table.id, table.clubId),
  foreignKey({
    name: 'horses_owner_member_club_fk',
    columns: [table.ownerMemberId, table.clubId],
    foreignColumns: [clubMembers.id, clubMembers.clubId],
  }),
  // Audit F-2 (2026-05-07 r4): SQL CHECK from migration 0024 — schema
  // drift fix. An active livery contract must either have zero monthly
  // fee (unbilled active horse) OR a billing start date set; prevents
  // a billing-cron crash on `null` start_date for an active row.
  check(
    'horses_active_requires_livery_start',
    sql`${table.ownershipStatus} <> 'active' OR COALESCE(${table.monthlyLiveryFeeMinor}, 0) = 0 OR ${table.liveryStartDate} IS NOT NULL`,
  ),
]);
