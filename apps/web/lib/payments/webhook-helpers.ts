import { runInTenantContext } from '@equestrian/db';
import {
  findBookingByProviderPaymentId,
  findPaymentAccountByExternalId,
  recordPaymentAccountError,
  setBookingPaymentRef,
} from '@equestrian/db/queries';
import { logger } from '@/lib/logger';
import type { PaymentIntentStatus, WebhookEvent } from './types';
import type { ProviderName } from './types';

/**
 * Maps our canonical intent status to the `payments.status` enum stored on
 * booking rows. `undefined` means "no status transition applies" (e.g. a
 * refund update, which is handled separately from intent lifecycle).
 */
function toBookingPaymentStatus(
  intent: PaymentIntentStatus | undefined,
): 'pending' | 'paid' | 'failed' | undefined {
  if (!intent) return undefined;
  if (intent === 'succeeded') return 'paid';
  if (intent === 'failed' || intent === 'cancelled') return 'failed';
  return 'pending';
}

export interface HandleWebhookOptions {
  provider: ProviderName;
  event: WebhookEvent;
  /** If known (e.g. from per-club URL), skip the external-id lookup. */
  overrideClubId?: string;
  /**
   * Refund-like events (`charge.refunded`, N-Genius `REFUNDED`, Ziina
   * `refund.status.updated` completed) override the normal intent mapping.
   */
  isRefundEvent?: boolean;
}

/**
 * Common post-verification flow: resolve the club, enter its tenant context,
 * and update the booking's payment status. Idempotent — replaying the same
 * event results in the same final state.
 */
export async function applyPaymentWebhook({
  provider,
  event,
  overrideClubId,
  isRefundEvent,
}: HandleWebhookOptions): Promise<{ clubId: string; bookingId: string } | null> {
  // 1. Resolve clubId via one of three paths, in priority order.
  let clubId = overrideClubId;

  if (!clubId && event.providerAccountId) {
    const account = await findPaymentAccountByExternalId(event.providerAccountId, provider);
    clubId = account?.clubId;
  }

  // 2. Fallback: match the provider_payment_id against an existing booking.
  //    Useful for Ziina where account_id isn't always in the payload.
  let bookingRef: { clubId: string; bookingId: string; currentPaymentStatus: string } | null = null;
  if (event.providerPaymentId) {
    bookingRef = await findBookingByProviderPaymentId(event.providerPaymentId, provider);
    if (!clubId) clubId = bookingRef?.clubId;
  }

  if (!clubId) {
    logger.warn('webhook_no_club_resolved', {
      provider,
      eventType: event.eventType,
      eventId: event.eventId,
      providerAccountId: event.providerAccountId ?? null,
      providerPaymentId: event.providerPaymentId ?? null,
    });
    return null;
  }

  if (!bookingRef && event.providerPaymentId) {
    bookingRef = await findBookingByProviderPaymentId(event.providerPaymentId, provider);
  }

  if (!bookingRef) {
    // Event is for a payment we don't have a booking for. Could be a test
    // event, a payment created outside the app, or a race with a booking
    // we haven't committed yet. Log and ack.
    logger.info('webhook_no_booking_for_event', {
      provider,
      eventType: event.eventType,
      providerPaymentId: event.providerPaymentId ?? null,
    });
    return null;
  }

  const nextStatus = isRefundEvent
    ? 'refunded'
    : toBookingPaymentStatus(event.status);

  if (!nextStatus) {
    // Nothing to update.
    return { clubId, bookingId: bookingRef.bookingId };
  }

  // Don't downgrade from `paid` or `refunded` back to `pending` — webhooks
  // can arrive out of order.
  const terminal = new Set(['paid', 'refunded']);
  if (
    terminal.has(bookingRef.currentPaymentStatus) &&
    !terminal.has(nextStatus)
  ) {
    logger.info('webhook_skipping_status_downgrade', {
      clubId,
      bookingId: bookingRef.bookingId,
      from: bookingRef.currentPaymentStatus,
      to: nextStatus,
    });
    return { clubId, bookingId: bookingRef.bookingId };
  }

  await runInTenantContext(clubId, () =>
    setBookingPaymentRef(clubId!, bookingRef!.bookingId, {
      paymentProvider: provider,
      providerPaymentId: event.providerPaymentId!,
      paymentStatus: nextStatus,
    }),
  );

  logger.info('booking_payment_status_updated_from_webhook', {
    clubId,
    bookingId: bookingRef.bookingId,
    provider,
    eventType: event.eventType,
    status: nextStatus,
  });

  return { clubId, bookingId: bookingRef.bookingId };
}

/**
 * Records a provider-side failure so the UI can surface `lastError` in the
 * settings panel. Non-fatal for the webhook — we don't want a DB write
 * failure to prevent us from returning 200.
 */
export async function safeRecordAccountError(
  clubId: string,
  provider: ProviderName,
  message: string,
): Promise<void> {
  try {
    await runInTenantContext(clubId, () =>
      recordPaymentAccountError(clubId, provider, message),
    );
  } catch (err) {
    logger.error('record_payment_account_error_failed', {
      clubId,
      provider,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
