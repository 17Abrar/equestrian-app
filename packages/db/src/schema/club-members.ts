import { pgTable, uuid, varchar, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userRoleEnum } from './enums';
import { clubs } from './clubs';

export const clubMembers = pgTable(
  'club_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    clerkUserId: varchar('clerk_user_id', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull(),
    displayName: varchar('display_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    isActive: boolean('is_active').notNull().default(true),
    // Audit J-1: distinguishes "admin kicked this member" from "member
    // left voluntarily". Both produce `is_active = false`, but only the
    // former should refuse rejoin via `joinClubInstantly`. Set by the
    // staff DELETE handler; null on voluntary-leave or normal members.
    deactivatedByAdminAt: timestamp('deactivated_by_admin_at', {
      withTimezone: true,
    }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('club_members_club_user_unique').on(table.clubId, table.clerkUserId),
    index('idx_club_members_user').on(table.clerkUserId),
    index('idx_club_members_role').on(table.clubId, table.role),
    // FK target for composite (member_id, club_id) -> club_members(id, club_id)
    // on rider_profiles, payments, invoices. Tautologically unique because id
    // is the PK, but Postgres needs the explicit constraint to use the column
    // pair as an FK target. See migration 0019.
    unique('club_members_id_club_unique').on(table.id, table.clubId),
    // Audit F-39 (2026-05-07 r5): partial index from migration 0029
    // backing `joinClubInstantly`'s "refuse rejoin if previously kicked"
    // path. Drizzle 0.45.2 supports `.where(...)` on indexes, so the
    // partial predicate now lives in TS too — drift fix from the prior
    // F-11 (round 4) comment-only treatment.
    index('idx_club_members_admin_deactivated')
      .on(table.clubId, table.clerkUserId)
      .where(sql`deactivated_by_admin_at IS NOT NULL`),
  ],
);
