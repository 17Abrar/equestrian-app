import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { getBookingsByClub } from '../queries/bookings';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

interface SeededBooking {
  clubId: string;
  memberId: string;
  bookingId: string;
}

async function seedBooking(slug: string, amount = 18_000): Promise<SeededBooking> {
  const [club] = await testDb.db
    .insert(clubs)
    .values({
      name: `Booking Projection ${slug}`,
      slug: `booking-projection-${slug}`,
      clerkOrgId: `org_booking_projection_${slug}`,
    })
    .returning({ id: clubs.id });
  const clubId = club!.id;

  const [member] = await testDb.db
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: `user_booking_projection_${slug}`,
      email: `${slug}@example.com`,
      displayName: `Rider ${slug}`,
      role: 'rider',
    })
    .returning({ id: clubMembers.id });
  const memberId = member!.id;

  const [lesson] = await testDb.db
    .insert(lessonTypes)
    .values({
      clubId,
      name: 'Group Desert Ride',
      type: 'desert_ride',
      price: 18_000,
      currency: 'AED',
    })
    .returning({ id: lessonTypes.id });

  const [slot] = await testDb.db
    .insert(bookingSlots)
    .values({
      clubId,
      lessonTypeId: lesson!.id,
      date: '2026-05-13',
      startTime: '18:00:00',
      endTime: '19:00:00',
      maxRiders: 6,
    })
    .returning({ id: bookingSlots.id });

  const [booking] = await testDb.db
    .insert(bookings)
    .values({
      clubId,
      slotId: slot!.id,
      riderMemberId: memberId,
      bookedByMemberId: memberId,
      status: 'confirmed',
      paymentStatus: 'pending',
      paymentMethod: 'card',
      amount,
      currency: 'AED',
    })
    .returning({ id: bookings.id });

  return { clubId, memberId, bookingId: booking!.id };
}

describe('getBookingsByClub list projection', () => {
  it('returns payment and lesson-price fields required by booking clients', async () => {
    const seeded = await seedBooking('fields');

    const result = await withTestDb(testDb.db, () =>
      getBookingsByClub(seeded.clubId, { page: 1, pageSize: 10 }),
    );

    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: seeded.bookingId,
      paymentStatus: 'pending',
      paymentMethod: 'card',
      amount: 18_000,
      currency: 'AED',
      lessonTypeName: 'Group Desert Ride',
      lessonTypeType: 'desert_ride',
      lessonTypePrice: 18_000,
      lessonTypeCurrency: 'AED',
      riderName: 'Rider fields',
    });
  });

  it('stays tenant-scoped even when another club has matching booking data', async () => {
    const clubA = await seedBooking('tenant-a', 18_000);
    const clubB = await seedBooking('tenant-b', 20_000);

    const allForA = await withTestDb(testDb.db, () =>
      getBookingsByClub(clubA.clubId, { page: 1, pageSize: 10 }),
    );
    expect(allForA.total).toBe(1);
    expect(allForA.data.map((row) => row.id)).toEqual([clubA.bookingId]);

    const forgedRiderFilter = await withTestDb(testDb.db, () =>
      getBookingsByClub(clubA.clubId, {
        riderMemberId: clubB.memberId,
        page: 1,
        pageSize: 10,
      }),
    );
    expect(forgedRiderFilter.total).toBe(0);
    expect(forgedRiderFilter.data).toEqual([]);
  });
});
