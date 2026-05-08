import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { recordBookingRefund, reverseBookingRefund } from '../queries/bookings';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

/**
 * Integration tests for the refund ledger — the fix for the 2026-04
 * audit's HIGH #4 finding. Partial refunds must (a) accumulate, (b)
 * leave the booking in 'partial' status until the running total hits
 * the original amount, and (c) reject attempts to over-refund.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

let seedCounter = 0;

async function seedPaidBooking(
  db: typeof testDb.db,
  amountMinor: number,
): Promise<{ clubId: string; bookingId: string }> {
  // Distinct slugs / clerk ids per call so a single test can seed more
  // than one isolated booking (e.g. the tenant-isolation case below).
  const n = ++seedCounter;
  const [club] = await db
    .insert(clubs)
    .values({
      name: `Test Club ${n}`,
      slug: `test-${n}`,
      clerkOrgId: `org_test_${n}`,
    })
    .returning({ id: clubs.id });
  const [member] = await db
    .insert(clubMembers)
    .values({
      clubId: club!.id,
      clerkUserId: `user_test_${n}`,
      email: `test${n}@example.com`,
      role: 'rider',
    })
    .returning({ id: clubMembers.id });
  const [lesson] = await db
    .insert(lessonTypes)
    .values({
      clubId: club!.id,
      name: 'Private',
      type: 'private',
      price: amountMinor,
    })
    .returning({ id: lessonTypes.id });
  const [slot] = await db
    .insert(bookingSlots)
    .values({
      clubId: club!.id,
      lessonTypeId: lesson!.id,
      date: '2026-05-01',
      startTime: '09:00:00',
      endTime: '10:00:00',
      maxRiders: 1,
    })
    .returning({ id: bookingSlots.id });
  const [booking] = await db
    .insert(bookings)
    .values({
      clubId: club!.id,
      slotId: slot!.id,
      riderMemberId: member!.id,
      bookedByMemberId: member!.id,
      amount: amountMinor,
      paymentStatus: 'paid',
    })
    .returning({ id: bookings.id });

  return { clubId: club!.id, bookingId: booking!.id };
}

describe('recordBookingRefund', () => {
  it('partial refund sets status="partial" and accumulates refundedAmountMinor', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    const result = await withTestDb(testDb.db, () =>
      recordBookingRefund(clubId, bookingId, 2_000),
    );
    expect(result?.paymentStatus).toBe('partial');
    expect(result?.refundedAmountMinor).toBe(2_000);
  });

  it('multiple partials compound; status stays "partial" until full', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      const first = await recordBookingRefund(clubId, bookingId, 2_000);
      expect(first?.paymentStatus).toBe('partial');
      expect(first?.refundedAmountMinor).toBe(2_000);

      const second = await recordBookingRefund(clubId, bookingId, 3_000);
      expect(second?.paymentStatus).toBe('partial');
      expect(second?.refundedAmountMinor).toBe(5_000);
    });
  });

  it('final refund that brings total to bookingAmount flips status to "refunded"', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(clubId, bookingId, 4_000);
      const final = await recordBookingRefund(clubId, bookingId, 6_000);
      expect(final?.paymentStatus).toBe('refunded');
      expect(final?.refundedAmountMinor).toBe(10_000);
    });
  });

  it('rejects a refund that would exceed the booking amount', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    const result = await withTestDb(testDb.db, () =>
      recordBookingRefund(clubId, bookingId, 10_001),
    );
    expect(result).toBeNull();
  });

  it('rejects a refund after the booking is already fully refunded', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      const full = await recordBookingRefund(clubId, bookingId, 10_000);
      expect(full?.paymentStatus).toBe('refunded');
      const extra = await recordBookingRefund(clubId, bookingId, 1);
      expect(extra).toBeNull();
    });
  });

  it('rejects a refund for a booking in another club (tenant isolation)', async () => {
    const first = await seedPaidBooking(testDb.db, 10_000);
    const second = await seedPaidBooking(testDb.db, 10_000);

    // Try to refund `second.bookingId` while scoped to `first.clubId`.
    const result = await withTestDb(testDb.db, () =>
      recordBookingRefund(first.clubId, second.bookingId, 1_000),
    );
    expect(result).toBeNull();
  });

  it('rejects a zero or negative amount', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      expect(await recordBookingRefund(clubId, bookingId, 0)).toBeNull();
      expect(await recordBookingRefund(clubId, bookingId, -500)).toBeNull();
    });
  });

  it('concurrent refunds serialize cleanly — no lost update', async () => {
    // Audit HIGH-4 (2026-05-05): the implementation now wraps the
    // read+CAS pair in `writeTransaction` with `SELECT … FOR UPDATE`.
    // The previous contract was OCC ("only one wins; the other gets a
    // 409"); the new contract serialises on the row lock so concurrent
    // admin clicks + webhook arrivals BOTH commit in order without
    // double-counting. This test enforces the lost-update prevention
    // invariant: two parallel refunds may both succeed, but the final
    // running total must equal their SUM — never less (lost update),
    // never more (over-refund).
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      const [a, b] = await Promise.all([
        recordBookingRefund(clubId, bookingId, 2_000),
        recordBookingRefund(clubId, bookingId, 3_000),
      ]);
      // Both should land — neither violates the over-refund cap (5_000
      // ≤ 10_000), and FOR UPDATE prevents the previous race window
      // where both read 0 and one's CAS lost.
      const successes = [a, b].filter((r) => r !== null);
      expect(successes.length).toBe(2);
      // Running total reflects both — lost-update would have left this
      // at 2_000 or 3_000 instead of 5_000.
      const finalTotal = Math.max(
        ...successes.map((r) => r!.refundedAmountMinor),
      );
      expect(finalTotal).toBe(5_000);
    });
  });
});

// Audit B-4 / H-10 — reverseBookingRefund is the failed-refund webhook
// counter-balance. Decrementing must restore the right paymentStatus
// and the right ledger value, and must refuse to drive the running
// total negative.
describe('reverseBookingRefund', () => {
  it('partial reversal flips status from refunded back to partial', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      // Get to fully-refunded.
      await recordBookingRefund(clubId, bookingId, 10_000);
      // Reverse half — webhook reports the second refund attempt failed.
      const reversed = await reverseBookingRefund(clubId, bookingId, 5_000);
      expect(reversed?.paymentStatus).toBe('partial');
      expect(reversed?.refundedAmountMinor).toBe(5_000);
    });
  });

  it('full reversal flips status all the way back to paid', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(clubId, bookingId, 4_000);
      const reversed = await reverseBookingRefund(clubId, bookingId, 4_000);
      expect(reversed?.paymentStatus).toBe('paid');
      expect(reversed?.refundedAmountMinor).toBe(0);
    });
  });

  it('refuses to drive the ledger negative', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(clubId, bookingId, 2_000);
      // Webhook claims to reverse 5_000 but only 2_000 was recorded —
      // that's a stale webhook or out-of-band ledger drift; refuse.
      const reversed = await reverseBookingRefund(clubId, bookingId, 5_000);
      expect(reversed).toBeNull();
    });
  });

  it('rejects zero or negative reversal amounts', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      expect(await reverseBookingRefund(clubId, bookingId, 0)).toBeNull();
      expect(await reverseBookingRefund(clubId, bookingId, -1)).toBeNull();
    });
  });

  it('refuses to reverse a refund for a booking in another club (tenant isolation)', async () => {
    const first = await seedPaidBooking(testDb.db, 10_000);
    const second = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(second.clubId, second.bookingId, 5_000);
      const result = await reverseBookingRefund(first.clubId, second.bookingId, 1_000);
      expect(result).toBeNull();
    });
  });
});

// Audit F-11 (2026-05-08 r6) — refund idempotency analysis.
//
// Validates the LEDGER-LEVEL behavior the audit's reasoning depended
// on: after a reverse-then-redo cycle, can the ledger correctly
// advance back to the target amount? Yes — the CAS in
// `recordBookingRefund` reads the live ledger (post-reversal: 0)
// and advances by the requested delta. This is the ledger half of
// the analysis.
//
// What the test does NOT cover (and why F-11 stays deferred):
// `recordBookingRefund` is called by the route AFTER a successful
// `adapter.refund(...)`. If Stripe replays a same-key idempotent
// request and returns the ORIGINAL refund object (now in `failed`
// status post-reversal), the route currently doesn't inspect
// `refund.status` before calling `recordBookingRefund`. The ledger
// would advance even though no new money moved.
//
// The fix per F-11 (drop `Date.now()` from the idempotency key) is
// CORRECT for the crash-mid-refund concern but introduces this
// reverse-then-redo silent-advance bug unless paired with a
// `refund.status`-aware recorder at the route layer. Until the
// follow-up PR adds that status check, `Date.now()` stays.
describe('recordBookingRefund — F-11 reverse-then-redo cycle', () => {
  it('post-reversal ledger advance restores the target amount', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      // Step 1: admin issues $50 refund.
      const first = await recordBookingRefund(clubId, bookingId, 5_000);
      expect(first?.refundedAmountMinor).toBe(5_000);
      expect(first?.paymentStatus).toBe('partial');

      // Step 2: that refund is reversed via the failed-refund webhook.
      const reversed = await reverseBookingRefund(clubId, bookingId, 5_000);
      expect(reversed?.refundedAmountMinor).toBe(0);
      expect(reversed?.paymentStatus).toBe('paid');

      // Step 3: admin re-issues the same $50 refund. The ledger
      // accepts it because the live running total is back to 0 —
      // the CAS in recordBookingRefund operates on the post-
      // reversal ledger value, not on a snapshot from before the
      // reversal. This is the load-bearing behavior F-11's
      // analysis depended on.
      const redo = await recordBookingRefund(clubId, bookingId, 5_000);
      expect(redo?.refundedAmountMinor).toBe(5_000);
      expect(redo?.paymentStatus).toBe('partial');
    });
  });

  it('post-full-reversal can re-issue a different amount', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(clubId, bookingId, 5_000);
      await reverseBookingRefund(clubId, bookingId, 5_000);
      // Admin changes their mind: refund $30 instead of $50 this time.
      const redo = await recordBookingRefund(clubId, bookingId, 3_000);
      expect(redo?.refundedAmountMinor).toBe(3_000);
      expect(redo?.paymentStatus).toBe('partial');
    });
  });

  it('refund-then-reverse-then-full-refund covers the booking', async () => {
    // Realistic sequence: rider asks for refund, admin clicks $50,
    // admin or Stripe reverses it, then admin re-refunds the FULL
    // booking amount. Ledger should correctly hit 'refunded' status.
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      await recordBookingRefund(clubId, bookingId, 5_000);
      await reverseBookingRefund(clubId, bookingId, 5_000);
      const final = await recordBookingRefund(clubId, bookingId, 10_000);
      expect(final?.refundedAmountMinor).toBe(10_000);
      expect(final?.paymentStatus).toBe('refunded');
    });
  });
});
