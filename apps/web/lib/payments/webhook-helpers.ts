import { after } from 'next/server';
import {
  attachWebhookEventClub,
  findBookingByIdForWebhook,
  findBookingByIdInDescription,
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
import { rawDb, writeTransaction } from '@equestrian/db';
import { bookings, clubs, clubMembers, horses } from '@equestrian/db/schema';
import { and, eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import type { PaymentIntentStatus, WebhookEvent } from './types';
import type { ProviderName } from './types';

/**
 * Audit F-3 (2026-05-07 r5): how many times to retry the cumulative→
 * delta computation under FOR UPDATE before escalating to permanent
 * failure. Bounded so a sustained writer (concurrent admin refund loop)
 * can't pin the webhook handler.
 *
 * Audit F-66 (2026-05-08 r6) — no exponential backoff between attempts.
 * With FOR UPDATE in place, contended rows queue at the lock anyway, so
 * each attempt naturally waits on the prior writer; an explicit sleep
 * loop adds latency without reducing contention. Trade-off: under a
 * sustained admin-refund loop the retry budget exhausts in <100ms and
 * the event escalates to `permanently_failed`. Operator recovery path
 * is straightforward — inspect the live ledger via the ledger detail
 * page, decide whether to manually re-apply the refund, then mark the
 * webhook event handled. Bumping to 5 attempts is a one-liner if real-
 * world incidents show the 3-attempt budget is too tight.
 */
const CUMULATIVE_REFUND_RETRY_ATTEMPTS = 3;

/**
 * Audit F-3 / F-21 (2026-05-07 r5): apply a cumulative refund target
 * against the live booking ledger inside a `writeTransaction` with
 * `SELECT … FOR UPDATE`. Recomputes `delta = cumulative - liveLedger`
 * after taking the lock so the value is current; updates the ledger
 * with the same CAS that `recordBookingRefund` uses.
 *
 * Retries up to `CUMULATIVE_REFUND_RETRY_ATTEMPTS` times when the CAS
 * inside the transaction rejects (which under FOR UPDATE shouldn't
 * happen, but a future writer that bypasses the lock would surface it).
 * On exhausted attempts, returns `kind: 'exhausted'` so the caller can
 * escalate via `markWebhookEventPermanentlyFailed`.
 *
 * Returns `over_refund` when the cumulative target itself exceeds the
 * booking amount — a genuine state divergence between us and the
 * provider that needs operator review.
 */
type CumulativeRefundResult =
  | {
      kind: 'recorded';
      delta: number;
      paymentStatus: string;
      refundedAmountMinor: number;
    }
  | { kind: 'already_recorded'; liveLedger: number }
  | { kind: 'over_refund'; bookingAmount: number; liveLedger: number }
  | { kind: 'exhausted'; lastSeenLedger: number };

async function applyCumulativeRefundFromWebhook(args: {
  clubId: string;
  bookingId: string;
  cumulativeTarget: number;
  eventType: string;
}): Promise<CumulativeRefundResult> {
  let lastSeenLedger = 0;
  for (let attempt = 0; attempt < CUMULATIVE_REFUND_RETRY_ATTEMPTS; attempt += 1) {
    const result = await writeTransaction(async (tx) => {
      const lockedRows = await tx
        .select({
          amount: bookings.amount,
          refundedAmountMinor: bookings.refundedAmountMinor,
          paymentStatus: bookings.paymentStatus,
        })
        .from(bookings)
        .where(and(eq(bookings.id, args.bookingId), eq(bookings.clubId, args.clubId)))
        .for('update')
        .limit(1);

      const locked = lockedRows[0];
      if (!locked || locked.amount == null) {
        return { kind: 'over_refund' as const, bookingAmount: 0, liveLedger: 0 };
      }

      const liveLedger = locked.refundedAmountMinor;
      const delta = args.cumulativeTarget - liveLedger;
      if (delta <= 0) {
        return { kind: 'already_recorded' as const, liveLedger };
      }

      const newRefunded = liveLedger + delta;
      if (newRefunded > locked.amount) {
        return {
          kind: 'over_refund' as const,
          bookingAmount: locked.amount,
          liveLedger,
        };
      }

      const newStatus = newRefunded >= locked.amount ? 'refunded' : 'partial';

      const updated = await tx
        .update(bookings)
        .set({
          refundedAmountMinor: newRefunded,
          paymentStatus: newStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bookings.id, args.bookingId),
            eq(bookings.clubId, args.clubId),
            // Belt-and-braces CAS — under FOR UPDATE this is a
            // tautology. Guards a future writer that bypasses the lock.
            eq(bookings.refundedAmountMinor, liveLedger),
          ),
        )
        .returning({
          paymentStatus: bookings.paymentStatus,
          refundedAmountMinor: bookings.refundedAmountMinor,
        });

      const updatedRow = updated[0];
      if (!updatedRow) {
        return { kind: 'cas_skip' as const, liveLedger };
      }

      return {
        kind: 'recorded' as const,
        delta,
        paymentStatus: updatedRow.paymentStatus,
        refundedAmountMinor: updatedRow.refundedAmountMinor,
      };
    });

    if (result.kind === 'recorded') {
      return result;
    }
    if (result.kind === 'already_recorded' || result.kind === 'over_refund') {
      return result;
    }
    // CAS skip — record last-seen ledger and retry.
    lastSeenLedger = result.liveLedger;
  }
  return { kind: 'exhausted', lastSeenLedger };
}

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
 * Result of `applyPaymentWebhook`. Three terminal kinds:
 *
 *  - `matched`: the event resolved to a booking and the helper applied
 *    the lifecycle. The route marks the dedup row `processed` (or
 *    `permanently_failed` when `permanentFailureReason` is set).
 *  - `no_target`: the helper resolved a club but couldn't find a
 *    booking for the event. The route should fall back to
 *    `applyLiveryInvoiceWebhook`; if THAT also returns no_target, the
 *    route marks dedup `permanently_failed` so the
 *    `webhook_permanently_failed` alert fires (audit F-19).
 *  - `null`: club itself couldn't be resolved (no clubId from URL,
 *    no providerAccountId, no matching booking). Route returns 200
 *    OK without writing dedup state.
 */
export type ApplyPaymentWebhookResult =
  | {
      kind: 'matched';
      clubId: string;
      bookingId: string;
      /**
       * Audit MED (2026-05-05 pass 2): when set, the caller MUST call
       * `markWebhookEventPermanentlyFailed` rather than
       * `markWebhookEventProcessed` — the event resolved to a booking
       * in a state where applying it would corrupt the ledger
       * (e.g. paid event for a cancelled booking, or F-3 cumulative
       * CAS retry exhausted). Replaying won't help; an operator needs
       * to step in.
       */
      permanentFailureReason?: string;
    }
  | { kind: 'no_target'; clubId: string };

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
}: HandleWebhookOptions): Promise<ApplyPaymentWebhookResult | null> {
  // 1. Resolve clubId via one of three paths, in priority order.
  let clubId = overrideClubId;

  if (!clubId && event.providerAccountId) {
    const account = await findPaymentAccountByExternalId(event.providerAccountId, provider);
    clubId = account?.clubId;
  }

  // 2. Fallback: match the provider_payment_id against an existing booking.
  //    Useful for Ziina where account_id isn't always in the payload.
  //
  // Audit F-11 / F-18 (2026-05-07 r5): when we already have a clubId from
  // the URL or external-id lookup, scope the provider-payment-id query to
  // that tenant. Without this scope, a future cross-tenant
  // `provider_payment_id` collision (Ziina docs reserve the right to
  // reuse intent ids across merchants under specific edge cases) would
  // resolve the wrong club's bookingRef and silently no-op every CAS
  // downstream — leaving forever-pending bookings the operator can't
  // trace. When `clubId` is still undefined here, the lookup falls
  // through unscoped (legacy callers); the no-club branch below then
  // handles that case.
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
    bookingRef = await findBookingByProviderPaymentId(
      event.providerPaymentId,
      provider,
      clubId,
    );
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
  //
  // Audit F-34 (2026-05-07 r5): only stamp the clubId when the
  // resolved bookingRef belongs to THIS club (or no bookingRef has
  // been resolved yet — the lookup may still find a match later via
  // metadata or description-recovery, and that path will be tenant-
  // scoped). Without this gate, a cross-tenant provider_payment_id
  // collision (resolved before F-11/F-18 scoping landed) would record
  // a foreign booking's clubId on the webhook_events row. F-11/F-18
  // makes this correct-by-construction; this guard is belt-and-braces
  // for any future caller that reaches the helper without an
  // override clubId.
  //
  // Audit F-48 (2026-05-07 r5): mirror `lib/email.ts`'s try/catch
  // fallback. `after()` throws when called outside a request lifecycle
  // (e.g. from a cron run that didn't establish one); pre-fix that
  // throw silently dropped the UPDATE with no log. Now we fall back
  // to a bare `void task()` so the work runs even when after() is
  // unavailable, and a warn surfaces the situation.
  if (!bookingRef || bookingRef.clubId === clubId) {
    const attachTask = async () => {
      try {
        await attachWebhookEventClub(provider, event.eventId, clubId);
      } catch (err) {
        logger.warn('attach_webhook_club_failed', {
          provider,
          eventId: event.eventId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    try {
      after(attachTask);
    } catch (err) {
      // Audit F-32 (2026-05-08 r6): the void-fallback fires when
      // `after()` is unavailable (cron path doesn't establish a
      // request lifecycle). The bare promise runs but if the isolate
      // is evicted before resolution the UPDATE silently drops —
      // per-club observability indexes (`idx_webhook_events_club_status`)
      // are then best-effort during cron. We escalate to `error` so
      // the cron_post_processing_after_unavailable count becomes
      // visible in Sentry; payment correctness is unaffected (the
      // dedup row is `processed` by the time after() fires) but the
      // observability gap is operator-actionable.
      logger.error('cron_post_processing_after_unavailable', {
        provider,
        eventId: event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      void attachTask();
    }
  } else {
    logger.warn('attach_webhook_club_skipped_cross_tenant', {
      provider,
      eventId: event.eventId,
      urlClubId: clubId,
      bookingClubId: bookingRef.clubId,
    });
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
        bookingStatus: fallback.bookingStatus,
        amount: fallback.amount,
        refundedAmountMinor: fallback.refundedAmountMinor,
        currency: fallback.currency,
      };
    }
  }

  // Audit F-22 / F-24 (2026-05-07 r5): last-ditch defense-in-depth —
  // parse the booking UUID out of the description we stamped at intent
  // creation. Stripe carries metadata.bookingId so the previous fallback
  // already resolves it; N-Genius and Ziina don't carry metadata, so
  // before this fix a fast-succeed event for those providers landed
  // before `setBookingPaymentRef` and stayed forever-pending until
  // manual reconciliation. The booking-payment route stamps
  // `[booking:UUID]` into the description (see route.ts:207); adapters
  // surface that as `event.descriptionForRecovery`. The lookup is
  // tenant-scoped via `findBookingByIdForWebhook` so a description
  // spoofed by another tenant's event can't bridge tenants.
  if (!bookingRef) {
    const descriptionFallback = await findBookingByIdInDescription(
      event.descriptionForRecovery,
      clubId,
    );
    if (descriptionFallback) {
      logger.info('webhook_booking_resolved_via_description', {
        clubId,
        bookingId: descriptionFallback.bookingId,
        provider,
        eventType: event.eventType,
        hadStoredProviderPaymentId: descriptionFallback.currentProviderPaymentId !== null,
      });
      bookingRef = {
        clubId: descriptionFallback.clubId,
        bookingId: descriptionFallback.bookingId,
        currentPaymentStatus: descriptionFallback.currentPaymentStatus,
        bookingStatus: descriptionFallback.bookingStatus,
        amount: descriptionFallback.amount,
        refundedAmountMinor: descriptionFallback.refundedAmountMinor,
        currency: descriptionFallback.currency,
      };
    }
  }

  if (!bookingRef) {
    // Event is for a payment we don't have a booking for. Could be a test
    // event, a payment created outside the app, or a genuine unknown.
    //
    // Audit F-19 (2026-05-07 r5): return `no_target` so the receiver
    // can fall back to `applyLiveryInvoiceWebhook`; if THAT also misses,
    // the route marks the dedup row `permanently_failed` (instead of
    // silently `processed`). Pre-fix, the dedup row flipped to
    // `processed` and the alert fires zero signal — operators couldn't
    // distinguish "we silently dropped 50 webhooks because Stripe was
    // retrying for a deleted club" from "no traffic."
    logger.info('webhook_no_booking_for_event', {
      provider,
      eventType: event.eventType,
      providerPaymentId: event.providerPaymentId ?? null,
      bookingId: event.bookingId ?? null,
    });
    return { kind: 'no_target', clubId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
  const explicitDelta = event.refundAmountMinor;
  const cumulativeTarget =
    isRefundEvent &&
    event.refundStatus === 'succeeded' &&
    explicitDelta == null &&
    typeof event.refundCumulativeMinor === 'number' &&
    event.refundCumulativeMinor > 0
      ? event.refundCumulativeMinor
      : undefined;

  // Audit F-3 / F-21 (2026-05-07 r5): when the delta is cumulative-
  // derived, the prior implementation read `bookingRef.refundedAmountMinor`
  // (a snapshot loaded hundreds of ms earlier in the resolve-club path)
  // and computed `delta = cumulative − snapshot` OUTSIDE any lock. A
  // concurrent admin refund (via the booking-refund route's
  // `writeTransaction` + FOR UPDATE) could advance the live ledger
  // between the snapshot and the recordBookingRefund CAS. The CAS
  // would then reject the cumulative-derived delta — and the helper
  // logged-and-returned, leaving the books undercounted. Real impact:
  // Stripe says cumulative=$50, our ledger says $20; admin push made
  // it $50 in between; webhook computed delta=$30, CAS rejected, ledger
  // stuck at $20 instead of $50. Silent payment loss in finance reports.
  //
  // The fix: when cumulative-derived, run the read+CAS pair inside a
  // `writeTransaction` with `SELECT … FOR UPDATE` on the booking row,
  // recompute delta against the LIVE ledger, retry on CAS-skip up to
  // `CUMULATIVE_REFUND_RETRY_ATTEMPTS` (3). On exhausted attempts,
  // signal `permanentFailureReason` so the route flips dedup to
  // `permanently_failed` and the alert fires — operators can manually
  // reconcile against the provider's cumulative. Mirrors the pattern
  // in `bookings/[bookingId]/refund/route.ts`.
  //
  // The per-event-delta path (Stripe `charge.refund.updated` with an
  // explicit refund.amount, N-Genius `PARTIALLY_REFUNDED` with a
  // surfaced `lastRefundAmountMinor`) doesn't need the retry — those
  // deltas are absolute and addable, so the existing
  // `recordBookingRefund` (which itself uses writeTransaction + FOR
  // UPDATE) handles concurrency cleanly.
  if (cumulativeTarget !== undefined) {
    const result = await applyCumulativeRefundFromWebhook({
      clubId,
      bookingId: bookingRef.bookingId,
      cumulativeTarget,
      eventType: event.eventType,
    });

    if (result.kind === 'recorded') {
      logger.info('booking_refund_recorded_from_webhook', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: result.delta,
        newPaymentStatus: result.paymentStatus,
        newRefundedAmountMinor: result.refundedAmountMinor,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }

    if (result.kind === 'already_recorded') {
      // Cumulative <= live ledger means we've already recorded this
      // (or more). Replay or out-of-order event — no-op.
      logger.info('webhook_refund_cumulative_already_recorded', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        cumulative: cumulativeTarget,
        liveLedger: result.liveLedger,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }

    if (result.kind === 'over_refund') {
      // Cumulative target exceeds booking.amount — provider state vs.
      // our ledger genuinely diverges (refunded more than was charged).
      // Operator must reconcile.
      logger.error('booking_refund_cumulative_exceeds_booking', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        cumulative: cumulativeTarget,
        bookingAmount: result.bookingAmount,
      });
      return {
        kind: 'matched',
        clubId,
        bookingId: bookingRef.bookingId,
        permanentFailureReason: `Refund cumulative (${cumulativeTarget}) exceeds booking amount (${result.bookingAmount}) — manual reconciliation required`,
      };
    }

    // result.kind === 'exhausted' — F-3 escalation path. Three FOR UPDATE
    // retries failed to apply the cumulative-derived delta because a
    // sustained concurrent writer kept advancing the ledger between
    // each lock release and the next read. This is operator-actionable.
    logger.error('booking_refund_cumulative_cas_exhausted', {
      clubId,
      bookingId: bookingRef.bookingId,
      eventType: event.eventType,
      cumulativeTarget,
      attempts: CUMULATIVE_REFUND_RETRY_ATTEMPTS,
      finalLedger: result.lastSeenLedger,
      note: 'Sustained concurrent writer prevented cumulative refund apply. Operator should reconcile against provider cumulative.',
    });
    return {
      kind: 'matched',
      clubId,
      bookingId: bookingRef.bookingId,
      permanentFailureReason: `Cumulative refund retry exhausted after ${CUMULATIVE_REFUND_RETRY_ATTEMPTS} attempts (target=${cumulativeTarget}, lastLedger=${result.lastSeenLedger}) — manual reconciliation required`,
    };
  }

  if (
    isRefundEvent &&
    event.refundStatus === 'succeeded' &&
    explicitDelta &&
    explicitDelta > 0
  ) {
    const recorded = await recordBookingRefund(
      clubId,
      bookingRef.bookingId,
      explicitDelta,
    );
    if (recorded) {
      logger.info('booking_refund_recorded_from_webhook', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: explicitDelta,
        newPaymentStatus: recorded.paymentStatus,
        newRefundedAmountMinor: recorded.refundedAmountMinor,
      });
    } else {
      // CAS conflict OR ledger already at this total OR the refund would
      // exceed the booking total. The first two are expected (idempotency
      // / replay); the third is a data-integrity concern.
      logger.info('booking_refund_record_skipped', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventType: event.eventType,
        refundAmountMinor: explicitDelta,
        currentPaymentStatus: bookingRef.currentPaymentStatus,
      });
    }
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
  }

  const nextStatus = isRefundEvent
    ? 'refunded'
    : toBookingPaymentStatus(event.status);

  if (!nextStatus) {
    // Nothing to update.
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
    return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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
      kind: 'matched',
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
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }
    if (event.amountReceivedMinorUnits == null) {
      logger.warn('webhook_no_amount_received', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }
    // Audit pass-3 (2026-05-09): refuse to compare an amount when the
    // event's currency is missing. Previously the `event.currency &&`
    // short-circuit silently skipped the mismatch guard, so a USD-
    // intent event without a currency field would fall straight into
    // the integer comparison against an AED booking — the comparison
    // is unitless and would pass underfund whenever the USD minor
    // units happened to exceed AED fils. N-Genius `extractOrderFields`
    // returns `amountCurrency: undefined` when the embedded payload
    // omits `payment[0].amount.currencyCode`; some Stripe `charge.
    // refund.updated` events lack a currency on the parent. Fail
    // closed: log + return without applying — operator triage tag is
    // `webhook_amount_without_currency`.
    if (!event.currency) {
      logger.error('webhook_amount_without_currency', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        amountReceived: event.amountReceivedMinorUnits,
        bookingCurrency: bookingRef.currency,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }
    if (event.currency.toUpperCase() !== bookingRef.currency.toUpperCase()) {
      logger.error('webhook_currency_mismatch', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        eventCurrency: event.currency,
        bookingCurrency: bookingRef.currency,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
    }
    if (event.amountReceivedMinorUnits < bookingRef.amount) {
      logger.error('webhook_amount_underfunded', {
        clubId,
        bookingId: bookingRef.bookingId,
        eventId: event.eventId,
        received: event.amountReceivedMinorUnits,
        expected: bookingRef.amount,
      });
      return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
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

  return { kind: 'matched', clubId, bookingId: bookingRef.bookingId };
}

/**
 * Result of `applyLiveryInvoiceWebhook`. Mirrors
 * `ApplyPaymentWebhookResult` so the receiver routes can pattern-match
 * on `kind` consistently across both helpers.
 *
 *  - `matched`: the event resolved to an invoice and the helper applied
 *    the lifecycle.
 *  - `no_target`: the helper looked but found no invoice. The route
 *    should mark dedup `permanently_failed` if `applyPaymentWebhook`
 *    also returned `no_target` (audit F-19).
 *  - `null`: no `providerPaymentId` on the event — nothing to look up.
 */
export type ApplyLiveryInvoiceWebhookResult =
  | {
      kind: 'matched';
      invoiceId: string;
      clubId: string;
      /**
       * Audit F-13 (2026-05-08 r6): when set, the receiver MUST mark
       * dedup `permanently_failed` rather than `processed` —
       * mirrors the booking-flow signal. Today only fired by the
       * paid-event-for-cancelled-invoice case (rider paid AFTER
       * admin cancelled; payment landed at merchant balance with no
       * automatic settlement; manual reconciliation required).
       */
      permanentFailureReason?: string;
    }
  | { kind: 'no_target' };

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
}): Promise<ApplyLiveryInvoiceWebhookResult | null> {
  if (!event.providerPaymentId) return null;

  const invoice = await findLiveryInvoiceByProviderPayment(
    event.providerPaymentId,
    provider,
    clubId,
  );
  // Audit F-19 (2026-05-07 r5): no_target so the receiver route can
  // mark dedup `permanently_failed` when applyPaymentWebhook also
  // missed. Pre-fix the helper returned plain `null` here, which the
  // route conflated with "no providerPaymentId" and silently flipped
  // dedup to `processed`.
  if (!invoice) return { kind: 'no_target' };

  // Only "succeeded" transitions the invoice to paid. A pending/failed event
  // shouldn't downgrade a paid invoice, and marking overdue from here would
  // conflict with the billing cron's day-count logic.
  if (event.status !== 'succeeded') {
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
  }

  if (invoice.status === 'paid') {
    // Already paid — webhook replay, idempotent no-op.
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
  }

  // Audit F-13 (2026-05-08 r6): paid event arriving for a cancelled
  // invoice means the rider's payment landed at the merchant balance
  // with no automatic settlement path — admin cancelled the invoice
  // before the webhook arrived. Rider has paid; invoice is voided;
  // someone has to manually refund or reconcile. Surface this as
  // `permanently_failed` (mirror booking-flow audit AI-24) so
  // operators see it in the alert pipeline. The receiver routes
  // (`stripe`, `ziina`, `n-genius`) check the
  // `permanentFailureReason` field and mark the dedup row
  // permanently_failed accordingly.
  if (invoice.status === 'cancelled') {
    if (event.amountReceivedMinorUnits != null && event.amountReceivedMinorUnits > 0) {
      logger.error('livery_webhook_paid_for_cancelled_invoice', {
        clubId: invoice.clubId,
        invoiceId: invoice.id,
        eventId: event.eventId,
        amountReceivedMinorUnits: event.amountReceivedMinorUnits,
      });
      return {
        kind: 'matched',
        invoiceId: invoice.id,
        clubId: invoice.clubId,
        permanentFailureReason:
          'Payment received for a cancelled livery invoice — manual reconciliation required',
      };
    }
    // Cancelled + non-paid event = idempotent no-op.
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
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
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
  }
  // Audit pass-3 (2026-05-09): refuse amount comparison when event
  // currency is missing — matches the booking-side fix above.
  if (!event.currency) {
    logger.error('livery_webhook_amount_without_currency', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      amountReceived: event.amountReceivedMinorUnits,
      invoiceCurrency: invoice.currency,
    });
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
  }
  if (event.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
    logger.error('livery_webhook_currency_mismatch', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      eventCurrency: event.currency,
      invoiceCurrency: invoice.currency,
    });
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
  }
  if (event.amountReceivedMinorUnits < invoice.amountMinorUnits) {
    logger.error('livery_webhook_amount_underfunded', {
      clubId: invoice.clubId,
      invoiceId: invoice.id,
      eventId: event.eventId,
      received: event.amountReceivedMinorUnits,
      expected: invoice.amountMinorUnits,
    });
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
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
    return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
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

  return { kind: 'matched', invoiceId: invoice.id, clubId: invoice.clubId };
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
