import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { clubs } from './clubs';
import { clubMembers } from './club-members';

export interface AudienceFilters {
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  activeWithinDays?: number;
  hasActivePackage?: boolean;
  minBookings?: number;
  tags?: string[];
}

export const audiences = pgTable(
  'audiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    filters: jsonb('filters').$type<AudienceFilters>().notNull().default({}),
    createdByMemberId: uuid('created_by_member_id').references(() => clubMembers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_audiences_club').on(table.clubId)],
);
