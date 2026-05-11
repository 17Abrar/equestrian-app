import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import { createBooking } from '../queries/bookings';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { coupons } from '../schema/packages';

/**
 * Integration tests for booking concurrency — audit AI-22.
 *
 * The slot's UPDATE-with-WHERE-and-FOR-UPDATE pattern (see
 * `createBooking` in queries/bookings.ts) is the only thing standing
 * between simultaneous riders booking the last seat and a slot blowing
 * past `maxRiders`. Pglite serialises concurrent transactions, but its
 * MVCC + FOR UPDATE semantics match Postgres for these test patterns —
 * the same code paths run in prod via the WS driver.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedClubWithSlot(
  db: typeof testDb.db,
  opts: {
    maxRiders: number;
    riderCount: number;
    couponMaxUses?: number;
    couponMaxUsesPerRider?: number;
  },
): Promise<{
  clubId: string;
  slotId: string;
  riderIds: string[];
  couponId: string;
}> {
  const [club] = await db
    .insert(clubs)
    .values({
      name: 'Concurrency Test Club',
      slug: 'concurrency-test',
      clerkOrgId: 'org_concurrency',
    })
    .returning({ id: clubs.id });
  const clubId = club!.id;

  const riderIds: string[] = [];
  for (let i = 0; i < opts.riderCount; i++) {
    const [m] = await db
      .insert(clubMembers)
      .values({
        clubId,
        clerkUserId: `user_concurrency_${i}`,
        email: `rider${i}@example.com`,
        role: 'rider',
      })
      .returning({ id: clubMembers.id });
    riderIds.push(m!.id);
  }

  const [lesson] = await db
    .insert(lessonTypes)
    .values({ clubId, name: 'Group', type: 'group', price: 10_000 })
    .returning({ id: lessonTypes.id });

  const [slot] = await db
    .insert(bookingSlots)
    .values({
      clubId,
      lessonTypeId: lesson!.id,
      date: '2026-05-01',
      startTime: '09:00:00',
      endTime: '10:00:00',
      maxRiders: opts.maxRiders,
    })
    .returning({ id: bookingSlots.id });

  const [coupon] = await db
    .insert(coupons)
    .values({
      clubId,
      code: 'CONCURRENCY10',
      discountType: 'percentage',
      discountValue: 10,
      maxUses: opts.couponMaxUses ?? null,
      maxUsesPerRider: opts.couponMaxUsesPerRider ?? null,
      status: 'active',
    })
    .returning({ id: coupons.id });

  return { clubId, slotId: slot!.id, riderIds, couponId: coupon!.id };
}

describe('createBooking — slot capacity', () => {
  it('rejects the second of two concurrent bookings on a 1-seat slot', async () => {
    const { clubId, slotId, riderIds } = await seedClubWithSlot(testDb.db, {
      maxRiders: 1,
      riderCount: 2,
    });

    const results = await withTestDb(testDb.db, () =>
      Promise.allSettled([
        createBooking(clubId, {
          slotId,
          riderMemberId: riderIds[0]!,
          bookedByMemberId: riderIds[0]!,
          amount: 10_000,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
        createBooking(clubId, {
          slotId,
          riderMemberId: riderIds[1]!,
          bookedByMemberId: riderIds[1]!,
          amount: 10_000,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
      ]),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: 'SLOT_FULL',
    });

    // Slot's currentRiders must equal max — never go past.
    const slotRow = await testDb.db
      .select({ currentRiders: bookingSlots.currentRiders })
      .from(bookingSlots)
      .where(eq(bookingSlots.id, slotId))
      .limit(1);
    expect(slotRow[0]?.currentRiders).toBe(1);
  });

  it('admits exactly maxRiders bookings when the slot capacity is N>1', async () => {
    const { clubId, slotId, riderIds } = await seedClubWithSlot(testDb.db, {
      maxRiders: 3,
      riderCount: 5,
    });

    const results = await withTestDb(testDb.db, () =>
      Promise.allSettled(
        riderIds.map((rid) =>
          createBooking(clubId, {
            slotId,
            riderMemberId: rid,
            bookedByMemberId: rid,
            amount: 10_000,
            paymentStatus: 'pending',
            status: 'confirmed',
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);

    const slotRow = await testDb.db
      .select({ currentRiders: bookingSlots.currentRiders })
      .from(bookingSlots)
      .where(eq(bookingSlots.id, slotId))
      .limit(1);
    expect(slotRow[0]?.currentRiders).toBe(3);
  });
});

describe('createBooking — coupon TOCTOU', () => {
  it('respects coupon maxUses across concurrent bookings', async () => {
    // 5 riders try to redeem a coupon capped at 2 uses on a 5-seat slot.
    // Without the FOR UPDATE on the coupon row, all 5 reads see
    // usage_count=0 and all 5 commit — blowing past maxUses.
    const { clubId, slotId, riderIds, couponId } = await seedClubWithSlot(testDb.db, {
      maxRiders: 5,
      riderCount: 5,
      couponMaxUses: 2,
    });

    const results = await withTestDb(testDb.db, () =>
      Promise.allSettled(
        riderIds.map((rid) =>
          createBooking(clubId, {
            slotId,
            riderMemberId: rid,
            bookedByMemberId: rid,
            amount: 9_000,
            discountAmount: 1_000,
            couponId,
            paymentStatus: 'pending',
            status: 'confirmed',
          }),
        ),
      ),
    );

    const successes = results.filter((r) => r.status === 'fulfilled').length;
    const couponBlocked = results.filter(
      (r) =>
        r.status === 'rejected' &&
        ((r as PromiseRejectedResult).reason as Error)?.message === 'COUPON_MAX_USES_REACHED',
    ).length;

    expect(successes).toBe(2);
    expect(couponBlocked).toBe(3);
  });

  it('respects coupon maxUsesPerRider when one rider double-books concurrently', async () => {
    // Rider tries to redeem the same coupon twice on a slot with maxRiders=3.
    // maxUsesPerRider=1 should block the second attempt.
    const { clubId, slotId, riderIds, couponId } = await seedClubWithSlot(testDb.db, {
      maxRiders: 3,
      riderCount: 1,
      couponMaxUsesPerRider: 1,
    });

    const rid = riderIds[0]!;
    const results = await withTestDb(testDb.db, () =>
      Promise.allSettled([
        createBooking(clubId, {
          slotId,
          riderMemberId: rid,
          bookedByMemberId: rid,
          amount: 9_000,
          discountAmount: 1_000,
          couponId,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
        createBooking(clubId, {
          slotId,
          riderMemberId: rid,
          bookedByMemberId: rid,
          amount: 9_000,
          discountAmount: 1_000,
          couponId,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
      ]),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const blocked = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    expect(blocked?.reason).toMatchObject({
      message: 'COUPON_RIDER_MAX_USES_REACHED',
    });
  });

  it('does not consume coupon uses when the slot is full', async () => {
    // Capacity-rejection must roll back the usage row + coupon counter
    // increment. Otherwise a "lucky loser" who hit a full slot with a
    // coupon attached would burn their per-rider allowance.
    const { clubId, slotId, riderIds, couponId } = await seedClubWithSlot(testDb.db, {
      maxRiders: 1,
      riderCount: 2,
      couponMaxUsesPerRider: 1,
    });

    await withTestDb(testDb.db, () =>
      Promise.allSettled([
        createBooking(clubId, {
          slotId,
          riderMemberId: riderIds[0]!,
          bookedByMemberId: riderIds[0]!,
          amount: 9_000,
          discountAmount: 1_000,
          couponId,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
        createBooking(clubId, {
          slotId,
          riderMemberId: riderIds[1]!,
          bookedByMemberId: riderIds[1]!,
          amount: 9_000,
          discountAmount: 1_000,
          couponId,
          paymentStatus: 'pending',
          status: 'confirmed',
        }),
      ]),
    );

    // Exactly one usage row should exist.
    const couponAfter = await testDb.db
      .select({ usageCount: coupons.usageCount })
      .from(coupons)
      .where(eq(coupons.id, couponId))
      .limit(1);
    expect(couponAfter[0]?.usageCount).toBe(1);

    // Exactly one booking row should exist (the rider who won the slot).
    const bookingsAfter = await testDb.db.select().from(bookings);
    expect(bookingsAfter).toHaveLength(1);
  });
});
