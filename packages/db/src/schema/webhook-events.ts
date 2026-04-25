import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  unique,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Dedup + status ledger for provider webhooks (Stripe, N-Genius, Ziina).
 *
 * Two-phase claim: the handler INSERTs a row with `status = 'received'`
 * before processing. On success it UPDATEs to `'processed'`; on failure
 * to `'failed'` (and returns 5xx so the provider retries). The unique
 * constraint on (provider, event_id) serialises concurrent duplicate
 * deliveries — exactly one caller wins the insert and proceeds, the
 * others see `'received'` (in-flight) or `'processed'` (skip).
 *
 * Crash recovery: a row stuck at `'received'` beyond the stale threshold
 * (see `claimWebhookEvent`) is treated as re-claimable on the next
 * retry, so a worker that died mid-processing doesn't permanently block
 * future deliveries of the same event.
 *
 * Old rows are not auto-expired. A retention cron should prune
 * `processed_at < now() - interval '30 days'` so the table doesn't grow
 * unbounded.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('processed'),
    attemptCount: integer('attempt_count').notNull().default(1),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('webhook_events_provider_event_unique').on(table.provider, table.eventId),
    index('idx_webhook_events_processed_at').on(table.processedAt),
    index('idx_webhook_events_status').on(table.status, table.lastAttemptedAt),
  ],
);
