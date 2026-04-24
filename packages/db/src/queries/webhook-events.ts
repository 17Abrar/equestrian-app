import { db } from '../index';
import { webhookEvents } from '../schema/webhook-events';

/**
 * Records a webhook delivery. Returns `true` when this is the first time
 * we've seen (provider, event_id) — the caller should proceed with the
 * side effects. Returns `false` when the event has already been
 * processed, in which case the caller should respond 200 and skip the
 * work. The unique constraint on (provider, event_id) makes this safe
 * under concurrent duplicate deliveries.
 */
export async function recordWebhookEventOrSkip(
  provider: string,
  eventId: string,
): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, eventId })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.eventId],
    })
    .returning({ id: webhookEvents.id });

  return inserted.length > 0;
}
