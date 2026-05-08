import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import { setBookingPaymentRef } from '../queries/bookings';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

/**
 * Audit follow-up (2026-05-08): pins down `setBookingPaymentRef`'s
 * transactional CAS rules. PR #84 closed the data-corruption window by
 * adding a SQL-CAS for the `cancelled` / `no_show` lifecycle states; the
 * follow-up wraps the read+CAS in a `writeTransaction(... FOR UPDATE)`
 * and folds the SQL CAS into JS conditionals against the locked row.
 *
 * These tests exercise the JS-CAS branches directly. Webhook tests
 * cover the same rules indirectly via the webhook-helpers path; this
 * file is specifically the layer-below contract.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedBooking(opts: {
  status?: 'confirmed' | 'cancelled' | 'no_show';
  paymentStatus?: 'pending' | 'paid' | 'partial' | 'refunded' | 'failed';
  providerPaymentId?: string | null;
}): Promise<{ clubId: string; bookingId: string }> {
  const { db } = testDb;

  const [club] = await db
    .insert(clubs)
    .values({
      name: 'Payment Ref Club',
      slug: 'payment-ref',
      clerkOrgId: 'org_payment_ref',
    })
    .returning({ id: clubs.id });
  const clubId = club!.id;

  const [member] = await db
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: 'user_payment_ref',
      email: 'rider@example.com',
      role: 'rider',
    })
    .returning({ id: clubMembers.id });

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
      maxRiders: 1,
    })
    .returning({ id: bookingSlots.id });

  const [booking] = await db
    .insert(bookings)
    .values({
      clubId,
      slotId: slot!.id,
      riderMemberId: member!.id,
      bookedByMemberId: member!.id,
      amount: 10_000,
      currency: 'AED',
      status: opts.status ?? 'confirmed',
      paymentStatus: opts.paymentStatus ?? 'pending',
      providerPaymentId: opts.providerPaymentId ?? null,
    })
    .returning({ id: bookings.id });

  return { clubId, bookingId: booking!.id };
}

describe('setBookingPaymentRef — lifecycle CAS', () => {
  it('refuses to attach a providerPaymentId when the booking is cancelled', async () => {
    const { clubId, bookingId } = await seedBooking({ status: 'cancelled' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, {
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_test_orphaned',
      }),
    );

    expect(result).toBeNull();

    // Persist check — the row must NOT have the new providerPaymentId.
    const row = await testDb.db
      .select({ providerPaymentId: bookings.providerPaymentId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    expect(row[0]?.providerPaymentId).toBeNull();
  });

  it('refuses to attach a providerPaymentId when the booking is no_show', async () => {
    const { clubId, bookingId } = await seedBooking({ status: 'no_show' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, {
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_test_orphaned',
      }),
    );

    expect(result).toBeNull();
  });

  it('admits the first providerPaymentId on a confirmed booking', async () => {
    const { clubId, bookingId } = await seedBooking({ status: 'confirmed' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, {
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_first',
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.providerPaymentId).toBe('pi_first');
    expect(result?.paymentProvider).toBe('stripe');
  });

  it('admits the same providerPaymentId idempotently', async () => {
    const { clubId, bookingId } = await seedBooking({
      status: 'confirmed',
      providerPaymentId: 'pi_already_set',
    });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, {
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_already_set',
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.providerPaymentId).toBe('pi_already_set');
  });

  it('refuses to overwrite a different providerPaymentId', async () => {
    const { clubId, bookingId } = await seedBooking({
      status: 'confirmed',
      providerPaymentId: 'pi_first',
    });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, {
        paymentProvider: 'stripe',
        providerPaymentId: 'pi_stale_replacement',
      }),
    );

    expect(result).toBeNull();

    const row = await testDb.db
      .select({ providerPaymentId: bookings.providerPaymentId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    expect(row[0]?.providerPaymentId).toBe('pi_first');
  });
});

describe('setBookingPaymentRef — paymentStatus terminal-state CAS', () => {
  it('refuses paid → pending downgrade', async () => {
    const { clubId, bookingId } = await seedBooking({ paymentStatus: 'paid' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, { paymentStatus: 'pending' }),
    );

    expect(result).toBeNull();
  });

  it('refuses failed → pending downgrade (out-of-order webhook retry)', async () => {
    const { clubId, bookingId } = await seedBooking({ paymentStatus: 'failed' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, { paymentStatus: 'pending' }),
    );

    expect(result).toBeNull();
  });

  it('admits paid → refunded forward transition', async () => {
    const { clubId, bookingId } = await seedBooking({ paymentStatus: 'paid' });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, { paymentStatus: 'refunded' }),
    );

    expect(result).not.toBeNull();
    expect(result?.paymentStatus).toBe('refunded');
  });

  it('refuses any non-refunded/partial update once refunded', async () => {
    const { clubId, bookingId } = await seedBooking({
      paymentStatus: 'refunded',
    });

    const result = await withTestDb(testDb.db, () =>
      setBookingPaymentRef(clubId, bookingId, { paymentStatus: 'paid' }),
    );

    expect(result).toBeNull();
  });
});
