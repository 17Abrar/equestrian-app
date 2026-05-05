import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { clubs } from './clubs';
import { clubMembers } from './club-members';

// audit M-1 (2026-05-05) — `hasActivePackage` and `tags` were declared
// here, accepted by every audience Zod validator, and persisted into
// `audiences.filters` (jsonb), but neither `resolveAudienceMembers` nor
// `countAudienceMembersBatch` ever evaluated them. The implementation
// drift would have shipped a broken email blast the moment the UI
// surfaced either control. Removed at every layer; migration 0032
// sanitises any persisted jsonb that still carries the keys.
//
// To re-introduce one of these filters in the future:
//   1. Add the field back to this interface.
//   2. Add it to all three Zod validators (POST/PATCH/preview).
//   3. Implement it in BOTH `resolveAudienceMembers` (SQL predicate) AND
//      `countAudienceMembersBatch` (in-memory predicate over the same
//      LEFT JOIN attribute set). The two paths must remain equivalent
//      for the live preview count to match the eventual recipient list.
//   4. Surface the control in `apps/web/components/emails/audiences-tab.tsx`.
export interface AudienceFilters {
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  activeWithinDays?: number;
  minBookings?: number;
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
