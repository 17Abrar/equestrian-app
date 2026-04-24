import { pgTable, uuid, varchar, timestamp, unique, index } from 'drizzle-orm/pg-core';

/**
 * Dedup ledger for provider webhooks. Every route inserts
 * (provider, event_id) before processing; the unique constraint
 * serialises concurrent duplicate deliveries so exactly one caller
 * sees the fresh insert and proceeds with the side effects (DB
 * writes, emails, refunds).
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('webhook_events_provider_event_unique').on(table.provider, table.eventId),
    index('idx_webhook_events_processed_at').on(table.processedAt),
  ],
);
