import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { webhookEvents } from '../schema/webhook-events';

/**
 * Result of `claimWebhookEvent`:
 *   - `claimed`: we hold the claim; the caller must follow up with
 *     `markWebhookEventProcessed` on success or `markWebhookEventFailed`
 *     on failure. Respond 200/5xx accordingly.
 *   - `already_processed`: the event was previously processed. The
 *     caller should respond 200 and skip the work.
 *   - `permanently_failed`: the event was tried `MAX_WEBHOOK_ATTEMPTS`
 *     times and a human needs to intervene. Caller should respond 200
 *     so the provider stops retrying and fire an alert (audit B-12).
 *   - `in_flight`: another worker is currently processing this event
 *     (within the stale window). The caller should respond 5xx so the
 *     provider retries later, at which point the in-flight worker will
 *     either have finished (→ `already_processed`) or crashed (→ the
 *     stale threshold lets the retry re-claim).
 */
export type WebhookClaim =
  | { status: 'claimed'; attempt: number }
  | { status: 'already_processed' }
  | { status: 'permanently_failed' }
  | { status: 'in_flight' };

/**
 * Maximum number of failed attempts before a webhook is parked in
 * `permanently_failed`. Picked to absorb transient blips (DB outage,
 * out-of-order Svix delivery for the org.created/membership.created race)
 * without burying operators under retry-noise alerts. See audit B-12.
 */
export const MAX_WEBHOOK_ATTEMPTS = 3;

/**
 * How long a `received` claim is trusted before another worker can
 * re-claim it. Must be a comfortable upper bound on normal processing
 * time; ours is sub-second. Too short = double-processing risk when a
 * slow worker gets overtaken. Too long = events sit stuck after a
 * genuine crash until the threshold elapses.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Claim a webhook event for processing. The unique (provider, event_id)
 * constraint serialises concurrent duplicate deliveries — exactly one
 * caller wins the INSERT and gets `{ status: 'claimed' }`.
 *
 * See `WebhookClaim` for caller semantics. On a successful claim, the
 * caller MUST eventually call `markWebhookEventProcessed` or
 * `markWebhookEventFailed`; otherwise the row stays `received` and
 * blocks re-deliveries until the stale threshold elapses.
 */
export async function claimWebhookEvent(
  provider: string,
  eventId: string,
): Promise<WebhookClaim> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, eventId, status: 'received', attemptCount: 1 })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.eventId],
    })
    .returning({ attemptCount: webhookEvents.attemptCount });

  const insertedRow = inserted[0];
  if (insertedRow) {
    return { status: 'claimed', attempt: insertedRow.attemptCount };
  }

  const existing = await db
    .select({
      status: webhookEvents.status,
      attemptCount: webhookEvents.attemptCount,
      lastAttemptedAt: webhookEvents.lastAttemptedAt,
    })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.eventId, eventId),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    // Conflict with no row present is a genuine anomaly (concurrent
    // DELETE?). Treat as in-flight so the provider retries.
    return { status: 'in_flight' };
  }

  if (row.status === 'processed') {
    return { status: 'already_processed' };
  }

  if (row.status === 'permanently_failed') {
    return { status: 'permanently_failed' };
  }

  // `failed` rows are re-claimable, but only if we haven't already burned
  // through `MAX_WEBHOOK_ATTEMPTS` retries (audit B-12). The route handler
  // can also short-circuit earlier by calling
  // `markWebhookEventPermanentlyFailed` directly (used by the Clerk
  // org-not-found race so each retry doesn't re-fire the alert).
  if (row.status === 'failed' && row.attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
    await db
      .update(webhookEvents)
      .set({ status: 'permanently_failed' })
      .where(
        and(
          eq(webhookEvents.provider, provider),
          eq(webhookEvents.eventId, eventId),
        ),
      );
    return { status: 'permanently_failed' };
  }

  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);
  const isStale =
    row.status === 'failed' ||
    (row.status === 'received' && row.lastAttemptedAt < staleCutoff);

  if (!isStale) {
    return { status: 'in_flight' };
  }

  // Re-claim. The `lastAttemptedAt` match in the WHERE is optimistic
  // concurrency: if two workers both see the row as stale, only the
  // first UPDATE observes the unchanged timestamp; the second's WHERE
  // no longer matches and it gets `in_flight`.
  const reclaimed = await db
    .update(webhookEvents)
    .set({
      status: 'received',
      attemptCount: row.attemptCount + 1,
      lastAttemptedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.eventId, eventId),
        eq(webhookEvents.lastAttemptedAt, row.lastAttemptedAt),
      ),
    )
    .returning({ attemptCount: webhookEvents.attemptCount });

  const reclaimedRow = reclaimed[0];
  if (!reclaimedRow) {
    return { status: 'in_flight' };
  }

  return { status: 'claimed', attempt: reclaimedRow.attemptCount };
}

export async function markWebhookEventProcessed(
  provider: string,
  eventId: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: 'processed',
      processedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.eventId, eventId),
      ),
    );
}

export async function markWebhookEventFailed(
  provider: string,
  eventId: string,
  errorMessage: string,
): Promise<void> {
  // Bump `lastAttemptedAt` so the staleness check in claimWebhookEvent has
  // a meaningful timestamp on the failed row (audit B-27). Without this,
  // every retry instantly re-claims a `failed` row regardless of how many
  // attempts ago it failed — making the attempt-count cap (B-12) the only
  // brake on permanent-retry-loop alert storms.
  await db
    .update(webhookEvents)
    .set({
      status: 'failed',
      lastError: errorMessage.slice(0, 1000),
      lastAttemptedAt: new Date(),
    })
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.eventId, eventId),
      ),
    );
}

/**
 * Hard-fail the event — Svix/Stripe/N-Genius will stop retrying once the
 * route returns 200, and a high-priority alert fires from
 * `webhook_permanently_failed` so an operator picks it up. Used when the
 * route knows further retries can't succeed (e.g. Clerk
 * organization.created delivery permanently lost; cron-reconcile would
 * close the gap, retry would not).
 */
export async function markWebhookEventPermanentlyFailed(
  provider: string,
  eventId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: 'permanently_failed',
      lastError: errorMessage.slice(0, 1000),
      lastAttemptedAt: new Date(),
    })
    .where(
      and(
        eq(webhookEvents.provider, provider),
        eq(webhookEvents.eventId, eventId),
      ),
    );
}
