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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskStatusEnum, postTypeEnum } from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { horses } from './horses';

export const groomTasks = pgTable('groom_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id),
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
});

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
});

export const communityTopics = pgTable('community_topics', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }),
  isDefault: boolean('is_default').notNull().default(false),
  clubId: uuid('club_id').references(() => clubs.id),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  pollOptions: jsonb('poll_options'),

  upvotes: integer('upvotes').notNull().default(0),
  downvotes: integer('downvotes').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),

  isPinned: boolean('is_pinned').notNull().default(false),
  isLocked: boolean('is_locked').notNull().default(false),
  isRemoved: boolean('is_removed').notNull().default(false),
  removedReason: text('removed_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const communityComments = pgTable('community_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => communityPosts.id, { onDelete: 'cascade' }),
  parentCommentId: uuid('parent_comment_id'),
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
});

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
  data: jsonb('data'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),

  emailSent: boolean('email_sent').notNull().default(false),
  pushSent: boolean('push_sent').notNull().default(false),
  smsSent: boolean('sms_sent').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id').references(() => clubs.id),
  actorMemberId: uuid('actor_member_id').references(() => clubMembers.id),

  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: uuid('resource_id'),
  changes: jsonb('changes'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
