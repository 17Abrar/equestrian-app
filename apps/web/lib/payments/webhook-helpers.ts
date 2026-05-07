import { after } from 'next/server';
import {
  attachWebhookEventClub,
  findBookingByIdForWebhook,
  findBookingByProviderPaymentId,
  findPaymentAccountByExternalId,
  recordBookingRefund,
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
): 'pending' | 'paid' | 'failed' | 'refunded' | 'partial' | undefined {
  if (!intent) return undefined;
  if (intent === 'succeeded') return 'paid';
  if (intent === 'failed' || intent === 'cancelled') return 'failed';
  if (intent === 'refunded') return 'refunded';
  if (intent === 'partial_refunded') return 'partial';
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
}: HandleWebhookOptions): Promise<{
  clubId: string;
  bookingId: string;
  /**
   * Audit MED (2026-05-05 pass 2): when set, the caller MUST call
   * `markWebhookEventPermanentlyFailed` rather than `markWebhookEventProcessed`
   * — the event resolved to a booking in a state where applying it
   * would corrupt the ledger (e.g. paid event for a cancelled booking).
   * Replaying won't help; an operator needs to step in.
   */
  permanentFailureReason?: string;
} | null> {
  // 1. Resolve clubId via one of three paths, in priority order.
  let clubId = overrideClubId;

  if (!clubId && event.providerAccountId) {
    const account = await findPaymentAccountByExternalId(event.providerAccountId, provider);
    clubId = account?.clubId;
  }

  // 2. Fallback: match the provider_payment_id against an existing booking.
  //    Useful for Ziina where account_id isn't always in the payload.
  let bookingRef: {
    clubId: string;
    bookingId: string;
    currentPaymentStatus: string;
    bookingStatus: string;
    amount: number | null;
    refundedAmountMinor: number;
    currency: string;
  } | null = null;
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

  // Audit MED-9 (2026-05-05): now that we've resolved this event to a
  // specific club, stamp the webhook_events row's `club_id` so per-
  // club observability queries hit the existing
  // `idx_webhook_events_club_status` index. Best-effort: a failure
  // here doesn't fail the request — the event is already claimed and
  // will process either way.
  //
  // Audit F-46 (2026-05-07 r4): the previous shape was bare
  // `void ... .catch(...)` — fire-and-forget. On Cloudflare Workers
  // the response can flush and the isolate evict before the UPDATE
  // commits, dropping the side-effect write. Wrap in Next.js `after()`
  // (14.2+) which hooks into the Worker's `ctx.waitUntil` so the
  // promise is guaranteed to settle before the isolate is recycled.
  // The UPDATE is non-critical (idempotent index optimization for the
  // per-club observability query) so a failure stays at warn — but
  // we want it to consistently succeed instead of probabilistically
  // succeed.
  after(async () => {
    try {
      await attachWebhookEventClub(provider, event.eventId, clubId);
    } catch (err) {
      logger.warn('attach_webhook_club_failed', {
        provider,
        eventId: event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

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
        bookingStatus: fallback.bookingStatus,
        amount: fallback.amount,
        refundedAmountMinor: fallback.refundedAmountMinor,
        currency: fallback.currency,
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

  // Audit F-3 (2026-05-06 comprehensive): refund webhooks with a non-
  // terminal `refundStatus` (Stripe `charge.refund.updated` with status
  // 'pending' for ACH/SEPA, 'requires_action', or 'canceled') must not
  // drive booking state. Without this short-circuit, the fall-through
  // below would set `paymentStatus='refunded'` while `refundedAmountMinor`
  // stays at 0 — silent payment loss. Only `'succeeded'` (recorded via
  // the cumulative or per-event delta branches) and `'failed'` (reversed
  // via the branch below) drive booking-state mutation.
  if (
    isRefundEvent &&
    event.refundStatus &&
    event.refundStatus !== 'succeeded' &&
    event.refundStatus !== 'failed'
  ) {
    logger.info('webhook_refund_non_terminal_status', {
      clubId,
      bookingId: bookingRef.bookingId,
      provider,
      eventType: event.eventType,
      refundStatus: event.refundStatus,
      currentPaymentStatus: bookingRef.currentPaymentStatus,
    });
    return { clubId, bookingId: bookingRef.bookingId };
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

  // Successful refund event with a known delta — increment the booking's
  // running refund total via `recordBookingRefund`. This handles three
  // important cases (audit C-1, H-3):
  //
  // 1. Out-of-band refund issued from the provider dashboard (Stripe / Ziina)
  //    that the admin refund route never saw. The refund delta is on the
  //    event; the route's own call would have already incremented the ledger
  //    if it had run, so the optimistic-CAS in `recordBookingRefund` makes
  //    this a safe no-op when there's no delta to apply.
  // 2. N-Genius partial refund (`PARTIALLY_REFUNDED`) issued from the
  //    portal — the booking's previous status is `paid`, refundedAmountMinor
  //    is 0, and the delta is the partial refund value.
  // 3. Replay of a refund event we already processed via the route — the CAS
  //    fails because `refundedAmountMinor` already equals the new value.
  // Audit HIGH-3 (2026-05-05): if the adapter signalled a CUMULATIVE
  // refund total (Stripe `charge.refunded` empty-`refunds.data` path),
  // convert to delta by subtracting the booking's existing ledger total.
  // This must run BEFORE the per-event-delta branch below, because a
  // single event can carry only one or the other and we prefer the
  // explicit delta when present.
  let derivedRefundDelta: number | undefined = event.refundAmountMinor;
  // Audit F-13 (2026-05-07 r4): when CAS skip happens AND the delta
  // was cumulative-derived, the snapshot ledger (loaded ~hundreds of
  // ms earlier) may be stale relative to a concurrent admin refund.
  // The CAS rejection is silent at info-level; track the source so
  // we can escalate to warn and surface the silent-drop case to
  // operators.
  let derivedFromCumulative = false;
  if (
    isRefundEvent &&
    event.refundStatus === 'succeeded' &&
    derivedRefundDelta == null &&
    typeof event.refundCumulativeMinor === 'number' &&
    event.refundCumulativeMinor > 0
  ) {
    const ledger = bookingRef.refundedAmountMinor;
    const delta = event.refundCumulativeMinor - ledger;
    if (delta > 0) {
      derivedRefundDelta = delta;
      derivedFromCumulative = true;
      logger.info('webhook_refund_cumulative_to_delta', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        cumulative: event.refundCumulativeMinor,
        priorLedger: ledger,
        delta,
      });
    } else {
      // Cumulative <= existing ledger means we've already recorded
      // this (or more). Replay or out-of-order event — no-op.
      logger.info('webhook_refund_cumulative_already_recorded', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        cumulative: event.refundCumulativeMinor,
        priorLedger: ledger,
      });
      return { clubId, bookingId: bookingRef.bookingId };
    }
  }

  if (
    isRefundEvent &&
    event.refundStatus === 'succeeded' &&
    derivedRefundDelta &&
    derivedRefundDelta > 0
  ) {
    const recorded = await recordBookingRefund(
      clubId,
      bookingRef.bookingId,
      derivedRefundDelta,
    );
    if (recorded) {
      logger.info('booking_refund_recorded_from_webhook', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: derivedRefundDelta,
        newPaymentStatus: recorded.paymentStatus,
        newRefundedAmountMinor: recorded.refundedAmountMinor,
      });
    } else if (derivedFromCumulative) {
      // Audit F-13 (2026-05-07 r4): CAS skip on a cumulative-derived
      // delta means the snapshot ledger was stale — a concurrent
      // admin refund advanced the ledger between our snapshot and
      // the CAS. The cumulative target is still authoritative; the
      // operator needs to reconcile (e.g., manually push the ledger
      // to the cumulative). Escalate to warn so it surfaces in
      // observability.
      logger.warn('booking_refund_cumulative_cas_skip', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        attemptedDelta: derivedRefundDelta,
        cumulativeTarget: event.refundCumulativeMinor ?? null,
        snapshotLedger: bookingRef.refundedAmountMinor,
        currentPaymentStatus: bookingRef.currentPaymentStatus,
        note: 'Snapshot ledger was stale; concurrent admin refund advanced it. Operator should reconcile against provider cumulative.',
      });
    } else {
      // CAS conflict OR ledger already at this total OR the refund would
      // exceed the booking total. The first two are expected (idempotency
      // / replay); the third is a data-integrity concern.
      logger.info('booking_refund_record_skipped', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: derivedRefundDelta,
        currentPaymentStatus: bookingRef.currentPaymentStatus,
      });
    }
    return { clubId, bookingId: bookingRef.bookingId };
  }

  // Partial-refund events that we mapped via `partial_refunded` but which
  // arrived without a refund delta the adapter could surface (e.g. malformed
  // N-Genius payload missing the embedded refunds list). Don't overwrite
  // `paid` with `refunded` — log so the operator can reconcile manually.
  if (isRefundEvent && event.status === 'partial_refunded' && !event.refundAmountMinor) {
    logger.warn('webhook_partial_refund_no_delta', {
      clubId,
      bookingId: bookingRef.bookingId,
      provider,
      eventType: event.eventType,
      currentPaymentStatus: bookingRef.currentPaymentStatus,
    });
    return { clubId, bookingId: bookingRef.bookingId };
  }

  // Refund events on an already-'partial' booking: the refund route is the
  // authoritative ledger (it tracks the running refunded total). Webhooks
  // don't always carry a reliable refund delta, so overriding 'partial' with
  // 'refunded' here would misrepresent the rider's remaining balance.
  // Successful refund events with a delta were already handled above.
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

  // Booking-status guard (audit AI-24). A payment_intent.succeeded landing
  // for a cancelled or no-show booking must NOT flip paymentStatus='paid'
  // — that would silently re-charge the rider for a lesson that's already
  // settled. Log loudly so an operator can refund / reattach manually.
  // (`nextStatus` from toBookingPaymentStatus is one of 'pending'|'paid'
  // |'failed'|'refunded' — 'partial' is only set by the refund route's
  // ledger and never by this helper, so it's not in the union.)
  if (
    nextStatus === 'paid' &&
    (bookingRef.bookingStatus === 'cancelled' || bookingRef.bookingStatus === 'no_show')
  ) {
    logger.error('webhook_payment_for_inactive_booking', {
      clubId,
      bookingId: bookingRef.bookingId,
      bookingStatus: bookingRef.bookingStatus,
      eventId: event.eventId,
      eventType: event.eventType,
      amountReceived: event.amountReceivedMinorUnits,
    });
    // Audit MED (2026-05-05 pass 2): the rider's payment is in the
    // merchant balance but the booking is already cancelled / no-show
    // — there's no automatic apply that's safe (silently flipping
    // `paymentStatus = paid` would re-charge a settled lesson). The
    // previous shape returned cleanly here and let the route flip the
    // dedup row to `processed`, leaving operators to spot the error
    // log only by accident. Surface it loud: signal `permanentFailure`
    // so the route calls `markWebhookEventPermanentlyFailed` and the
    // `webhook_permanently_failed` alert fires for an operator to
    // review (refund manually, or reattach the booking).
    return {
      clubId,
      bookingId: bookingRef.bookingId,
      permanentFailureReason: `Payment received for a ${bookingRef.bookingStatus} booking — manual reconciliation required`,
    };
  }

  // Amount/currency reconciliation (audit AI-21). Without this guard, a
  // crafted low-amount PaymentIntent on the connected account with
  // metadata.bookingId set would mark any booking paid. Refund-flow
  // events (isRefundEvent) bypass this check — they have their own
  // amount semantics handled above.
  if (nextStatus === 'paid' && !isRefundEvent) {
    if (bookingRef.amount == null) {
      logger.warn('webhook_booking_missing_amount', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
      });
      return { clubId, bookingId: bookingRef.bookingId };
    }
    if (event.amountReceivedMinorUnits == null) {
      logger.warn('webhook_no_amount_received', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
      });
      return { clubId, bookingId: bookingRef.bookingId };
    }
    if (
      event.currency &&
      event.currency.toUpperCase() !== bookingRef.currency.toUpperCase()
    ) {
      logger.error('webhook_currency_mismatch', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        eventCurrency: event.currency,
        bookingCurrency: bookingRef.currency,
      });
      return { clubId, bookingId: bookingRef.bookingId };
    }
    if (event.amountReceivedMinorUnits < bookingRef.amount) {
      logger.error('webhook_amount_underfunded', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        received: event.amountReceivedMinorUnits,
        expected: bookingRef.amount,
      });
      return { clubId, bookingId: bookingRef.bookingId };
    }
    // Audit F-12 (2026-05-07 r4): warn-level overfund. We still mark the
    // booking paid (the rider has paid; refusing the apply would leave them
    // stuck), but surface the discrepancy so finance can issue the difference
    // back. Symmetric with the underfund branch above.
    if (event.amountReceivedMinorUnits > bookingRef.amount) {
      logger.error('webhook_amount_overfunded', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        received: event.amountReceivedMinorUnits,
        expected: bookingRef.amount,
        overfundMinor: event.amountReceivedMinorUnits - bookingRef.amount,
      });
    }
  }

  const updated = await setBookingPaymentRef(clubId, bookingRef.bookingId, {
    paymentProvider: provider,
    providerPaymentId: event.providerPaymentId,
    paymentStatus: nextStatus,
  });

  // Audit M-3: distinguish "row updated" from "guard fired (no-op)".
  // The terminal-state guard inside setBookingPaymentRef returns null
  // when the booking was already in `refunded`/`partial`; logging the
  // success message regardless makes observability lie.
  if (updated) {
    logger.info('booking_payment_status_updated_from_webhook', {
      clubId,
      bookingId: bookingRef.bookingId,
      provider,
      eventType: event.eventType,
      status: nextStatus,
    });
  } else {
    logger.info('webhook_status_no_op_due_to_terminal_state', {
      clubId,
      bookingId: bookingRef.bookingId,
      provider,
      eventType: event.eventType,
      attempted: nextStatus,
      currentStatus: bookingRef.currentPaymentStatus,
    });
  }

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
  clubId,
}: {
  provider: ProviderName;
  event: WebhookEvent;
  /**
   * Audit MED (2026-05-05 pass 2): the URL clubId from the webhook
   * receiver path. Every receiver has it (`/api/webhooks/<provider>/[clubId]`).
   * Threading it through scopes the invoice lookup to a single tenant —
   * defense-in-depth against any future cross-merchant payment-id
   * collision.
   */
  clubId?: string;
}): Promise<{ invoiceId: string; clubId: string } | null> {
  if (!event.providerPaymentId) return null;

  const invoice = await findLiveryInvoiceByProviderPayment(
    event.providerPaymentId,
    provider,
    clubId,
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

  // Audit F-1 (2026-05-06 round 2). Mirror the booking-flow
  // amount/currency reconciliation (audit AI-21). Without this guard,
  // a legitimately-signed event for a different invoice or a different
  // amount on the same connected account silently marks the wrong
  // invoice paid — e.g. a misrouted Ziina/N-Genius webhook can settle
  // a 5,000 AED invoice against a 200 AED test transaction. The
  // signature step gatekeeps third-party forgery; this gatekeeps
  // intra-account misrouting.
  if (event.amountReceivedMinorUnits == null) {
    logger.warn('livery_webhook_no_amount_received', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
    });
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }
  if (
    event.currency &&
    event.currency.toUpperCase() !== invoice.currency.toUpperCase()
  ) {
    logger.error('livery_webhook_currency_mismatch', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      eventCurrency: event.currency,
      invoiceCurrency: invoice.currency,
    });
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }
  if (event.amountReceivedMinorUnits < invoice.amountMinorUnits) {
    logger.error('livery_webhook_amount_underfunded', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      received: event.amountReceivedMinorUnits,
      expected: invoice.amountMinorUnits,
    });
    return { invoiceId: invoice.id, clubId: invoice.clubId };
  }
  // Audit F-12 (2026-05-07 r4): symmetric overfund branch — mirrors the
  // booking flow. Don't block the apply (the club has paid); surface the
  // discrepancy so finance can refund the difference.
  if (event.amountReceivedMinorUnits > invoice.amountMinorUnits) {
    logger.error('livery_webhook_amount_overfunded', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      received: event.amountReceivedMinorUnits,
      expected: invoice.amountMinorUnits,
      overfundMinor: event.amountReceivedMinorUnits - invoice.amountMinorUnits,
    });
  }

  const paidAt = new Date();
  const updated = await markLiveryInvoicePaid(invoice.clubId, invoice.id, {
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
