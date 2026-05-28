import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  date,
  timestamp,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { leaseTypeEnum, leaseStatusEnum } from './enums';
import { clubs } from './clubs';
import { horses } from './horses';
import { clubMembers } from './club-members';

/**
 * Horse leases — half-lease and full-lease arrangements between a
 * horse and a lessee rider. See migration 0064 for the design notes.
 *
 * Composite FKs `(horse_id, club_id) → horses(id, club_id)` and
 * `(lessee_member_id, club_id) → club_members(id, club_id)` enforce
 * tenant isolation at the DB layer; mirrors the audit-pass composite-
 * FK pattern (migrations 0017, 0019, 0033, 0038, 0040-0048).
 *
 * Free-text rendering policy: `notes` is plain text only (no
 * dangerouslySetInnerHTML; no DOMPurify in the tree). See CLAUDE.md
 * free-text rendering policy 2026-05-13.
 */
export const horseLeases = pgTable(
  'horse_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Inline single-column FKs intentionally omitted; the composite
    // FKs in the table-extras below carry the tenant invariant.
    horseId: uuid('horse_id').notNull(),
    lesseeMemberId: uuid('lessee_member_id').notNull(),

    leaseType: leaseTypeEnum('lease_type').notNull(),
    monthlyFeeMinor: integer('monthly_fee_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),

    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),

    status: leaseStatusEnum('status').notNull().default('pending'),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_horse_leases_club_status').on(table.clubId, table.status),
    index('idx_horse_leases_horse_status').on(table.horseId, table.status),
    index('idx_horse_leases_lessee_status').on(table.lesseeMemberId, table.status),
    foreignKey({
      name: 'horse_leases_horse_club_fk',
      columns: [table.horseId, table.clubId],
      foreignColumns: [horses.id, horses.clubId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'horse_leases_lessee_club_fk',
      columns: [table.lesseeMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    check('horse_leases_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
    check('horse_leases_monthly_fee_nonneg_check', sql`${table.monthlyFeeMinor} >= 0`),
  ],
);
