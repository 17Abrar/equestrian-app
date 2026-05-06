import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  time,
  integer,
  boolean,
  timestamp,
  jsonb,
  inet,
  unique,
  check,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskStatusEnum, postTypeEnum } from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { horses } from './horses';

// ─── Typed jsonb shapes (audit AI-43) ────────────────────────────────

/** Per-option vote tally on a community poll post. */
export interface PollOption {
  /** Free-form label shown to voters. */
  label: string;
  /** Running count, incremented by the vote endpoint. */
  count: number;
}

/** Notification `data` payload — discriminated by the row's `type` column.
 *  Free-form record by design (each notification type has its own keys);
 *  consumers narrow at read time using the `type` column. */
export type NotificationData = Record<string, unknown>;

/** Audit-log `changes` payload — produced by the `ctx.audit({ changes })`
 *  helper in api-utils. Each top-level key is a column name; each value
 *  carries the before/after state. `unknown` rather than a tighter union
 *  because audited columns span every table (booking status, fee int,
 *  paymentStatus enum, etc.) and tightening here would force casts at
 *  every call site. */
export interface AuditLogChange {
  from: unknown;
  to: unknown;
}
export type AuditLogChanges = Record<string, AuditLogChange>;

export const groomTasks = pgTable('groom_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  // Audit MED (2026-05-06 third pass): the inline single-column FK was
  // dropped in migration 0038 and replaced with a composite
  // `(horse_id, club_id) → horses(id, club_id)` declared in the
  // table-extras below. Same pattern as 0017 used on the horse-health
  // sub-tables — the DB layer rejects mismatched-tenant inserts even
  // if a future handler skips the route-level precheck.
  horseId: uuid('horse_id').notNull(),
  assignedToMemberId: uuid('assigned_to_member_id').references(() => clubMembers.id),

  taskType: varchar('task_type', { length: 100 }).notNull(),
  description: text('description'),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time'),
  status: taskStatusEnum('status').notNull().default('pending'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedByMemberId: uuid('completed_by_member_id').references(() => clubMembers.id),
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_groom_tasks_date').on(table.clubId, table.scheduledDate),
  index('idx_groom_tasks_assigned').on(table.assignedToMemberId, table.scheduledDate),
  index('idx_groom_tasks_horse').on(table.horseId, table.scheduledDate),
  foreignKey({
    name: 'groom_tasks_horse_club_fk',
    columns: [table.horseId, table.clubId],
    foreignColumns: [horses.id, horses.clubId],
  }).onDelete('cascade'),
]);

export const riderAchievements = pgTable('rider_achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  riderMemberId: uuid('rider_member_id')
    .notNull()
    .references(() => clubMembers.id),

  achievementType: varchar('achievement_type', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  notified: boolean('notified').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_achievements_rider').on(table.riderMemberId),
]);

export const communityTopics = pgTable('community_topics', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: varchar('name', { length: 255 }).notNull(),
  // Audit AI-13 pass-2: was `unique()` globally — two clubs couldn't both
  // use the same per-club topic slug ("general", "events", etc.).
  // Migration 0035 swaps to a per-club composite unique declared in the
  // table-extras below. Default-system topics with `clubId IS NULL` keep
  // working: Postgres's UNIQUE treats NULL as "not equal to NULL" by
  // default, so global-default rows don't collide with per-club rows
  // sharing the same slug.
  slug: varchar('slug', { length: 100 }).notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }),
  isDefault: boolean('is_default').notNull().default(false),
  clubId: uuid('club_id').references(() => clubs.id),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_topics_club').on(table.clubId),
  unique('community_topics_club_slug_unique').on(table.clubId, table.slug),
]);

export const communityPosts = pgTable('community_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  topicId: uuid('topic_id')
    .notNull()
    .references(() => communityTopics.id),
  authorMemberId: uuid('author_member_id')
    .notNull()
    .references(() => clubMembers.id),
  authorClubId: uuid('author_club_id')
    .notNull()
    .references(() => clubs.id),

  postType: postTypeEnum('post_type').notNull().default('discussion'),
  title: varchar('title', { length: 500 }),
  body: text('body').notNull(),
  mediaUrls: text('media_urls').array(),
  // Audit AI-43 — typed jsonb. Each option carries a free-form label and
  // a running tally (`count`) updated by the vote endpoint.
  pollOptions: jsonb('poll_options').$type<PollOption[]>(),

  upvotes: integer('upvotes').notNull().default(0),
  downvotes: integer('downvotes').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),

  isPinned: boolean('is_pinned').notNull().default(false),
  isLocked: boolean('is_locked').notNull().default(false),
  isRemoved: boolean('is_removed').notNull().default(false),
  removedReason: text('removed_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_posts_topic_created').on(table.topicId, table.createdAt),
  index('idx_posts_author').on(table.authorMemberId),
]);

export const communityComments = pgTable('community_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => communityPosts.id, { onDelete: 'cascade' }),
  // Self-referencing FK (audit C-11). Without this, a deleted parent
  // comment leaves orphan replies pointing at a defunct UUID and the
  // threaded view renders empty placeholders. ON DELETE CASCADE so a
  // moderator's hard-delete of a parent removes the entire subtree —
  // matches the post-level cascade above.
  parentCommentId: uuid('parent_comment_id').references(
    (): import('drizzle-orm/pg-core').AnyPgColumn => communityComments.id,
    { onDelete: 'cascade' },
  ),
  authorMemberId: uuid('author_member_id')
    .notNull()
    .references(() => clubMembers.id),
  authorClubId: uuid('author_club_id')
    .notNull()
    .references(() => clubs.id),

  body: text('body').notNull(),
  upvotes: integer('upvotes').notNull().default(0),
  downvotes: integer('downvotes').notNull().default(0),
  isRemoved: boolean('is_removed').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_comments_post').on(table.postId),
  index('idx_comments_parent').on(table.parentCommentId),
]);

export const communityVotes = pgTable(
  'community_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => clubMembers.id),
    postId: uuid('post_id').references(() => communityPosts.id),
    commentId: uuid('comment_id').references(() => communityComments.id),
    voteType: integer('vote_type').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('community_votes_member_post_unique').on(table.memberId, table.postId),
    unique('community_votes_member_comment_unique').on(table.memberId, table.commentId),
    check('vote_type_check', sql`${table.voteType} IN (1, -1)`),
  ],
);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id').references(() => clubs.id),
  recipientMemberId: uuid('recipient_member_id')
    .notNull()
    .references(() => clubMembers.id),

  type: varchar('type', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  // Audit AI-43 — typed jsonb. Notification payloads are union-typed by
  // `type`; consumers narrow at read time. Storing as
  // `Record<string, JsonValue>` is closer to the contract than `unknown`
  // and lets the read-side use a discriminated union.
  data: jsonb('data').$type<NotificationData | null>(),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),

  emailSent: boolean('email_sent').notNull().default(false),
  pushSent: boolean('push_sent').notNull().default(false),
  smsSent: boolean('sms_sent').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_notifications_recipient').on(table.recipientMemberId, table.isRead),
  index('idx_notifications_date').on(table.recipientMemberId, table.createdAt),
]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ON DELETE SET NULL on both club + actor (audit C-12). Schema declares
  // these nullable so a deleted club / departed member doesn't tear down
  // the audit trail; previously NO ACTION blocked club deletion entirely.
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  actorMemberId: uuid('actor_member_id').references(() => clubMembers.id, {
    onDelete: 'set null',
  }),

  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: uuid('resource_id'),
  // Audit AI-43 — `{ field: { from, to } }` is the canonical shape; the
  // route helpers (`ctx.audit({ changes })`) already produce it.
  changes: jsonb('changes').$type<AuditLogChanges | null>(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_audit_club').on(table.clubId, table.createdAt),
  index('idx_audit_actor').on(table.actorMemberId, table.createdAt),
  index('idx_audit_resource').on(table.resourceType, table.resourceId),
]);
