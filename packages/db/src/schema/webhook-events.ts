import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { webhookEventStatusEnum } from './enums';
import { clubs } from './clubs';

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
 *
 * Audit F-33 (2026-05-06): no `created_at` / `updated_at` by design.
 * `last_attempted_at` doubles as the row-creation timestamp (defaultNow,
 * NOT NULL); `processed_at` flips once on success. The pair carries
 * the lifecycle data those columns would otherwise duplicate. This is
 * the only table in the schema without the standard timestamp pair —
 * documented here so a future schema reviewer doesn't add them back.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    // Tenant scope (audit H-1, H-5). Nullable so events that arrive
    // without an obvious club mapping (e.g. unknown N-Genius outlet)
    // can still be persisted for replay; the route handler stamps it
    // once the event resolves to an account.
    //
    // Audit F-2 (2026-05-06 round 2). Note: the unique constraint
    // BELOW is `(provider, event_id)` — `club_id` is NOT part of it.
    // The previous version of this comment claimed it was, which was
    // wrong. The current shape relies on each provider generating
    // globally-unique event IDs per merchant account: Stripe `evt_…`
    // are globally unique, and the N-Genius / Ziina adapters
    // synthesize equivalent uniqueness (see `derivedEventId` in
    // n-genius.ts and the body-hash composite in ziina.ts). The
    // claim protocol (`claimWebhookEvent`) inserts BEFORE `club_id`
    // is resolved, so a 3-column unique would silently break dedup
    // for the NULL-club initial-insert case. If a future provider
    // with merchant-scoped event IDs is added, the claim protocol
    // needs to resolve club_id upfront — at which point the unique
    // constraint can change in lockstep.
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    // Default reflects the two-phase claim protocol: a fresh row starts as
    // `'received'` (in-flight), the success path UPDATEs to `'processed'`,
    // and the failure path UPDATEs to `'failed'`. The previous default of
    // `'processed'` lied about state — every caller passes `status` explicitly
    // so the default was unreachable, but a future contributor reading the
    // schema would draw the wrong conclusion.
    // Audit QA-36 — promoted to pgEnum.
    status: webhookEventStatusEnum('status').notNull().default('received'),
    attemptCount: integer('attempt_count').notNull().default(1),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    // Nullable (audit H-9) — only set once status flips to 'processed'.
    // Previous NOT NULL DEFAULT now() conflated "row inserted" with "event
    // processed", causing the retention cron to delete `received`/`failed`
    // rows that had been stuck mid-flight — silent loss of unfinished work.
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    unique('webhook_events_provider_event_unique').on(table.provider, table.eventId),
    index('idx_webhook_events_processed_at').on(table.processedAt),
    index('idx_webhook_events_status').on(table.status, table.lastAttemptedAt),
    // (audit H-5) — surfaces "all events for club X" for ops dashboards
    // without a full-table scan.
    index('idx_webhook_events_club_status').on(table.clubId, table.status),
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 —
    // schema drift fix. Attempt counter cannot go negative.
    check('webhook_events_attempt_count_nonneg_check', sql`${table.attemptCount} >= 0`),
  ],
);
