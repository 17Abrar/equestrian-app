import { pgTable, uuid, varchar, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
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
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('club_members_club_user_unique').on(table.clubId, table.clerkUserId)],
);
