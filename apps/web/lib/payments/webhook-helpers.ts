import {
  findBookingByIdForWebhook,
  findBookingByProviderPaymentId,
  findPaymentAccountByExternalId,
  recordPaymentAccountError,
  reverseBookingRefund,
  setBookingPaymentRef,
  findLiveryInvoiceByProviderPayment,
  markLiveryInvoicePaid,
} from '@equestrian/db/queries';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { LiveryPaymentReceived } from '@equestrian/email-templates/livery-payment-received';
import { rawDb } from '@equestrian/db';
import { clubs, clubMembers, horses } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
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
): 'pending' | 'paid' | 'failed' | 'refunded' | undefined {
  if (!intent) return undefined;
  if (intent === 'succeeded') return 'paid';
  if (intent === 'failed' || intent === 'cancelled') return 'failed';
  if (intent === 'refunded') return 'refunded';
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

  // (Removed a duplicate findBookingByProviderPaymentId call here that
  // re-ran the same query with the same args — the lookup at line 70
  // already covers it. Audit E-14.)

  // TOCTOU fallback. The route stores `providerPaymentId` on the booking
  // AFTER calling the adapter; a fast-succeed webhook (Apple Pay, 3DS
  // instant-succeed) can arrive in that gap. The `provider_payment_id`
  // lookup above misses because the DB hasn't been updated yet — but
  // adapters that support metadata (Stripe) embed the bookingId in the
  // PI, letting us resolve the booking directly by id. The result of
  // `findBookingByIdForWebhook` is scoped to `clubId`, so a malicious
  // event from Club A claiming a booking from Club B won't match.
  if (!bookingRef && event.bookingId) {
    const fallback = await findBookingByIdForWebhook(event.bookingId, clubId);
    if (fallback) {
      logger.info('webhook_booking_resolved_via_metadata', {
        clubId,
        bookingId: fallback.bookingId,
        provider,
        eventType: event.eventType,
        hadStoredProviderPaymentId: fallback.currentProviderPaymentId !== null,
      });
      bookingRef = {
        clubId: fallback.clubId,
        bookingId: fallback.bookingId,
        currentPaymentStatus: fallback.currentPaymentStatus,
      };
    }
  }

  if (!bookingRef) {
    // Event is for a payment we don't have a booking for. Could be a test
    // event, a payment created outside the app, or a genuine unknown.
    logger.info('webhook_no_booking_for_event', {
      provider,
      eventType: event.eventType,
      providerPaymentId: event.providerPaymentId ?? null,
      bookingId: event.bookingId ?? null,
    });
    return null;
  }

  // A `pending → failed` refund transition (Stripe `charge.refund.updated`
  // with refund.status = 'failed') means money the rider thought they got
  // back actually never returned. Reverse the ledger entry so finance reports
  // and future refund attempts see the correct running total — see audit
  // B-4. Refund amount comes from the refund object directly (not the
  // charge's cumulative `amount_refunded`).
  if (isRefundEvent && event.refundStatus === 'failed' && event.refundAmountMinor) {
    const reversed = await reverseBookingRefund(
      clubId,
      bookingRef.bookingId,
      event.refundAmountMinor,
    );
    if (reversed) {
      logger.warn('booking_refund_reversed', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: event.refundAmountMinor,
        newPaymentStatus: reversed.paymentStatus,
        newRefundedAmountMinor: reversed.refundedAmountMinor,
      });
    } else {
      // The webhook arrived for a refund we never recorded, OR the running
      // total is smaller than the amount we'd reverse, OR an optimistic-
      // concurrency conflict landed. Surface as warn so operators can
      // reconcile from the provider dashboard.
      logger.warn('booking_refund_reverse_skipped', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: event.refundAmountMinor,
        currentPaymentStatus: bookingRef.currentPaymentStatus,
      });
    }
    return { clubId, bookingId: bookingRef.bookingId };
  }

  // Refund events on an already-'partial' booking: the refund route is the
  // authoritative ledger (it tracks the running refunded total). Webhooks
  // don't carry a reliable refund amount, so overriding 'partial' with
  // 'refunded' here would misrepresent the rider's remaining balance.
  if (isRefundEvent && bookingRef.currentPaymentStatus === 'partial') {
    logger.info('webhook_preserving_partial_refund_status', {
      clubId,
      bookingId: bookingRef.bookingId,
      eventType: event.eventType,
    });
    return { clubId, bookingId: bookingRef.bookingId };
  }

  const nextStatus = isRefundEvent
    ? 'refunded'
    : toBookingPaymentStatus(event.status);

  if (!nextStatus) {
    // Nothing to update.
    return { clubId, bookingId: bookingRef.bookingId };
  }

  // Don't downgrade from a terminal state back to `pending` — webhooks
  // can arrive out of order.
  const terminal = new Set(['paid', 'partial', 'refunded']);
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

  if (!event.providerPaymentId) {
    // Unreachable: `bookingRef` is only ever populated by a lookup keyed on
    // `event.providerPaymentId`. Belt-and-braces so the setBookingPaymentRef
    // call below doesn't need a non-null assertion.
    logger.warn('webhook_missing_payment_id_on_matched_booking', {
      clubId,
      bookingId: bookingRef.bookingId,
      provider,
      eventType: event.eventType,
    });
    return { clubId, bookingId: bookingRef.bookingId };
  }

  await setBookingPaymentRef(clubId, bookingRef.bookingId, {
    paymentProvider: provider,
    providerPaymentId: event.providerPaymentId,
    paymentStatus: nextStatus,
  });

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
 * Livery invoice webhook application — mirrors applyPaymentWebhook but for
 * livery_invoices rather than bookings. Returns the invoice if matched, or
 * null if this event doesn't correspond to any livery invoice (in which
 * case the payment is probably a booking — caller should fall back).
 *
 * Only acts on succeeded payments. Other statuses (pending, failed) leave
 * the invoice alone — we can't reliably tell "intent failed so mark
 * overdue" from a single event; the billing cron handles that cadence.
 */
export async function applyLiveryInvoiceWebhook({
  provider,
  event,
}: {
  provider: ProviderName;
  event: WebhookEvent;
}): Promise<{ invoiceId: string; clubId: string } | null> {
  if (!event.providerPaymentId) return null;

  const invoice = await findLiveryInvoiceByProviderPayment(
    event.providerPaymentId,
    provider,
  );
  if (!invoice) return null;

  // Only "succeeded" transitions the invoice to paid. A pending/failed event
  // shouldn't downgrade a paid invoice, and marking overdue from here would
  // conflict with the billing cron's day-count logic.
  if (event.status !== 'succeeded') {
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }

  if (invoice.status === 'paid' || invoice.status === 'cancelled') {
    // Already terminal — webhook replay, idempotent no-op.
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }

  const paidAt = new Date();
  const updated = await markLiveryInvoicePaid(invoice.id, {
    paidAt,
    paymentProvider: provider,
    providerPaymentId: event.providerPaymentId,
  });

  if (!updated) {
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }

  // Fetch what we need for the email — owner contact, club name, horse name.
  // One round-trip, rawDb because we're outside any tenant transaction.
  // Defence-in-depth: bind clubId on every join so a malformed invoice (one
  // whose ownerMemberId/horseId points at a foreign club) can't render an
  // email to the wrong person. Audit A-3.
  const detail = await rawDb
    .select({
      clubName: clubs.name,
      ownerEmail: clubMembers.email,
      ownerName: clubMembers.displayName,
      horseName: horses.name,
    })
    .from(clubs)
    .innerJoin(
      clubMembers,
      and(eq(clubMembers.id, invoice.ownerMemberId), eq(clubMembers.clubId, invoice.clubId)),
    )
    .innerJoin(
      horses,
      and(eq(horses.id, invoice.horseId), eq(horses.clubId, invoice.clubId)),
    )
    .where(eq(clubs.id, invoice.clubId))
    .limit(1);

  const d = detail[0];
  if (d?.ownerEmail) {
    sendTriggeredEmailAsync({
      clubId: invoice.clubId,
      trigger: 'livery_payment_received',
      to: d.ownerEmail,
      subject: `Payment received — ${d.horseName}`,
      template: LiveryPaymentReceived({
        ownerName: d.ownerName ?? 'there',
        horseName: d.horseName,
        clubName: d.clubName,
        invoiceNumber: invoice.invoiceNumber,
        amountMinorUnits: invoice.amountMinorUnits,
        currency: invoice.currency,
        paidDate: paidAt.toISOString().slice(0, 10),
      }),
    });
  }

  logger.info('livery_invoice_marked_paid_from_webhook', {
    clubId: invoice.clubId,
    invoiceId: invoice.id,
    provider,
  });

  return { invoiceId: invoice.id, clubId: invoice.clubId };
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
    await recordPaymentAccountError(clubId, provider, message);
  } catch (err) {
    logger.error('record_payment_account_error_failed', {
      clubId,
      provider,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
