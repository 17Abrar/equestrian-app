import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { audiences } from './audiences';

/**
 * Task #22 (2026-05-28): durable log of every email this club
 * attempted to send. Backs the in-app "Recently sent" tab and replaces
 * the previous "check the Resend dashboard" workaround. Migration
 * 0066 owns the schema and indexes.
 *
 * Composite FK on (sender_member_id, club_id) → club_members(id,
 * club_id) gives atomic tuple integrity (a row can't claim a sender
 * from another club). Unlike audit_log, this table's club_id is
 * NOT NULL, so the composite FK uses ON DELETE NO ACTION — SET NULL
 * would try to null both columns and abort the cascade. The app only
 * ever deactivates members (no hard-delete), and a club hard-delete
 * cascades through the outer `club_id → clubs.id` FK before the
 * composite RI check fires. See migration 0066 for the comment trail.
 */
export const emailSendLog = pgTable(
  'email_send_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    senderMemberId: uuid('sender_member_id'),
    toEmail: varchar('to_email', { length: 320 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    audienceId: uuid('audience_id'),
    trigger: varchar('trigger', { length: 64 }),
    /**
     * Coarse bucket — UI filter only. Distinct from `trigger` which is
     * fine-grained for transactional sends.
     */
    source: varchar('source', { length: 20 }).notNull(),
    /**
     * Lifecycle:
     *   - 'queued'     written before the Resend POST resolves
     *   - 'sent'       Resend ACK'd with an id
     *   - 'failed'     Resend returned non-2xx OR the request errored
     *   - 'suppressed' isEmailSuppressed short-circuited before POST
     */
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    /** Resend email id — cross-reference for bounce/complaint debugging. */
    resendId: text('resend_id'),
    /** Sanitized error message on failure (matches the API contract). */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_email_send_log_club_recent').on(table.clubId, table.createdAt),
    index('idx_email_send_log_club_status').on(table.clubId, table.status, table.createdAt),
    foreignKey({
      name: 'email_send_log_sender_member_club_fk',
      columns: [table.senderMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }).onDelete('no action'),
    // Audit pass-11 (2026-06-06): composite (audience_id, club_id) FK so a
    // broadcast log row can't reference another club's audience (matches the
    // tenant-FK convention used for sender_member_id). Migration 0068 replaces
    // the prior single-column audience_id FK with this. ON DELETE NO ACTION
    // (not SET NULL): club_id is NOT NULL, so a composite SET NULL would try to
    // null club_id and abort. `deleteAudience` clears email_send_log.audience_id
    // in the same transaction before deleting, preserving the prior
    // "log kept, audience ref cleared" behavior.
    foreignKey({
      name: 'email_send_log_audience_club_fk',
      columns: [table.audienceId, table.clubId],
      foreignColumns: [audiences.id, audiences.clubId],
    }).onDelete('no action'),
    check(
      'email_send_log_source_check',
      sql`${table.source} IN ('manual_single', 'manual_broadcast', 'transactional')`,
    ),
    check(
      'email_send_log_status_check',
      sql`${table.status} IN ('queued', 'sent', 'failed', 'suppressed')`,
    ),
  ],
);

export type EmailSendStatus = 'queued' | 'sent' | 'failed' | 'suppressed';
export type EmailSendSource = 'manual_single' | 'manual_broadcast' | 'transactional';
