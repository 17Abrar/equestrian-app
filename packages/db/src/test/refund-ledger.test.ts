import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { recordBookingRefund } from '../queries/bookings';
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

  it('optimistic concurrency: two parallel refunds — only one wins', async () => {
    const { clubId, bookingId } = await seedPaidBooking(testDb.db, 10_000);
    await withTestDb(testDb.db, async () => {
      const [a, b] = await Promise.all([
        recordBookingRefund(clubId, bookingId, 2_000),
        recordBookingRefund(clubId, bookingId, 3_000),
      ]);
      // Exactly one should have landed; the other gets null and the
      // caller returns 409 (see refund route's REFUND_RACE branch).
      const successes = [a, b].filter((r) => r !== null);
      expect(successes.length).toBe(1);
    });
  });
});
