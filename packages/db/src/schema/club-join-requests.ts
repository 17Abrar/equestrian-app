import { pgTable, uuid, varchar, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { clubs } from './clubs';
import { clubMembers } from './club-members';

/**
 * Rider-initiated membership proposals. Only created when a club's join policy
 * is `approval` — for `open` clubs the API inserts directly into
 * `club_members`, and `invite_only` clubs never accept join requests.
 */
export const clubJoinRequests = pgTable(
  'club_join_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    clerkUserId: varchar('clerk_user_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    displayName: varchar('display_name', { length: 255 }),
    message: text('message'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    reviewedByMemberId: uuid('reviewed_by_member_id').references(() => clubMembers.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('club_join_requests_unique_pending').on(table.clubId, table.clerkUserId),
    index('idx_join_requests_club_status').on(table.clubId, table.status, table.createdAt),
    index('idx_join_requests_user').on(table.clerkUserId),
  ],
);

export type JoinRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
