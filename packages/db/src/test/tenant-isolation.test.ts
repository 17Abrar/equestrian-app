import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { getBookingById, findBookingByIdForWebhook } from '../queries';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

/**
 * Integration tests for the tenant isolation invariant — the
 * fundamental multi-tenancy guarantee that a caller authenticated into
 * Club A cannot read or mutate Club B's rows. Application-layer
 * `club_id` scoping is the sole enforcement mechanism (RLS was
 * deliberately dropped — see migration 0011), which makes this
 * invariant testable but also fragile. Any new `*by` query that omits
 * the `club_id` filter is a cross-tenant read.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

interface Seeded {
  clubA: string;
  clubB: string;
  memberA: string;
  memberB: string;
  bookingA: string;
  bookingB: string;
}

/**
 * Creates two isolated clubs with one member and one booking each.
 * Returns the ids for assertions.
 */
async function seedTwoClubs(db: typeof testDb.db): Promise<Seeded> {
  const [clubA] = await db
    .insert(clubs)
    .values({ name: 'Alpha Riding Club', slug: 'alpha', clerkOrgId: 'org_alpha' })
    .returning({ id: clubs.id });
  const [clubB] = await db
    .insert(clubs)
    .values({ name: 'Bravo Equestrian', slug: 'bravo', clerkOrgId: 'org_bravo' })
    .returning({ id: clubs.id });

  const [memberA] = await db
    .insert(clubMembers)
    .values({
      clubId: clubA!.id,
      clerkUserId: 'user_alpha',
      email: 'alpha@example.com',
      role: 'rider',
    })
    .returning({ id: clubMembers.id });
  const [memberB] = await db
    .insert(clubMembers)
    .values({
      clubId: clubB!.id,
      clerkUserId: 'user_bravo',
      email: 'bravo@example.com',
      role: 'rider',
    })
    .returning({ id: clubMembers.id });

  const [lessonA] = await db
    .insert(lessonTypes)
    .values({
      clubId: clubA!.id,
      name: 'Private A',
      type: 'private',
      price: 10000,
    })
    .returning({ id: lessonTypes.id });
  const [lessonB] = await db
    .insert(lessonTypes)
    .values({
      clubId: clubB!.id,
      name: 'Private B',
      type: 'private',
      price: 20000,
    })
    .returning({ id: lessonTypes.id });

  const [slotA] = await db
    .insert(bookingSlots)
    .values({
      clubId: clubA!.id,
      lessonTypeId: lessonA!.id,
      date: '2026-05-01',
      startTime: '09:00:00',
      endTime: '10:00:00',
      maxRiders: 1,
    })
    .returning({ id: bookingSlots.id });
  const [slotB] = await db
    .insert(bookingSlots)
    .values({
      clubId: clubB!.id,
      lessonTypeId: lessonB!.id,
      date: '2026-05-01',
      startTime: '09:00:00',
      endTime: '10:00:00',
      maxRiders: 1,
    })
    .returning({ id: bookingSlots.id });

  const [bookingA] = await db
    .insert(bookings)
    .values({
      clubId: clubA!.id,
      slotId: slotA!.id,
      riderMemberId: memberA!.id,
      bookedByMemberId: memberA!.id,
      amount: 10000,
    })
    .returning({ id: bookings.id });
  const [bookingB] = await db
    .insert(bookings)
    .values({
      clubId: clubB!.id,
      slotId: slotB!.id,
      riderMemberId: memberB!.id,
      bookedByMemberId: memberB!.id,
      amount: 20000,
    })
    .returning({ id: bookings.id });

  return {
    clubA: clubA!.id,
    clubB: clubB!.id,
    memberA: memberA!.id,
    memberB: memberB!.id,
    bookingA: bookingA!.id,
    bookingB: bookingB!.id,
  };
}

describe('tenant isolation — bookings', () => {
  it('getBookingById(clubA, bookingA) returns the booking', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getBookingById(seeded.clubA, seeded.bookingA));
    expect(result?.id).toBe(seeded.bookingA);
  });

  it('getBookingById(clubA, bookingB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getBookingById(seeded.clubA, seeded.bookingB));
    expect(result).toBeNull();
  });

  it('findBookingByIdForWebhook(bookingB, clubA) returns null — rejects cross-club webhook', async () => {
    // Same invariant from the webhook side: an event signed by Club A
    // that claims to be for Club B's booking must not resolve.
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      findBookingByIdForWebhook(seeded.bookingB, seeded.clubA),
    );
    expect(result).toBeNull();
  });

  it('findBookingByIdForWebhook(bookingA, clubA) returns the booking', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      findBookingByIdForWebhook(seeded.bookingA, seeded.clubA),
    );
    expect(result?.bookingId).toBe(seeded.bookingA);
    expect(result?.clubId).toBe(seeded.clubA);
  });
});
