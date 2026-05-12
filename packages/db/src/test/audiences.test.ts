import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { MS_PER_DAY } from '@equestrian/shared/constants';
import { createTestDb, withTestDb } from './harness';
import {
  countAudienceMembers,
  countAudienceMembersBatch,
  resolveAudienceMembers,
} from '../queries/audiences';
import { audiences } from '../schema/audiences';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { riderProfiles } from '../schema/rider-profiles';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';

/**
 * Audit M-1 regression coverage. Two invariants this suite locks down:
 *
 *   1. The dead `hasActivePackage` / `tags` keys are gone at every layer
 *      AND any persisted jsonb that still carries them is sanitised by
 *      migration 0032. Verified by inserting a row with the keys via
 *      raw jsonb (bypassing the now-narrow TS interface), re-running
 *      the migration's UPDATE, and asserting the keys are stripped.
 *
 *   2. `resolveAudienceMembers` (SQL-side) and `countAudienceMembersBatch`
 *      (in-memory over the same LEFT JOIN attribute set) stay
 *      equivalent. This is the docstring contract on
 *      `countAudienceMembersBatch` — if the two paths diverge, the live
 *      preview count would lie about the eventual recipient list.
 *      Future work that adds a filter back has to extend BOTH paths and
 *      this test catches the asymmetric case.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

interface SeedResult {
  clubId: string;
  /** Beginner with 5 bookings, last one today. */
  riderActiveBeginner: string;
  /** Intermediate with 1 booking 200 days ago. */
  riderStaleIntermediate: string;
  /** Advanced with 0 bookings ever. */
  riderNewAdvanced: string;
}

let seedCounter = 0;

async function seedClub(): Promise<SeedResult> {
  const n = ++seedCounter;
  const [club] = await testDb.db
    .insert(clubs)
    .values({
      name: `Audience Test Club ${n}`,
      slug: `aud-test-${n}`,
      clerkOrgId: `org_aud_${n}`,
    })
    .returning({ id: clubs.id });
  const clubId = club!.id;

  const [m1] = await testDb.db
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: `user_aud_${n}_1`,
      email: `aud${n}-1@example.com`,
      role: 'rider',
    })
    .returning({ id: clubMembers.id });
  const [m2] = await testDb.db
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: `user_aud_${n}_2`,
      email: `aud${n}-2@example.com`,
      role: 'rider',
    })
    .returning({ id: clubMembers.id });
  const [m3] = await testDb.db
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: `user_aud_${n}_3`,
      email: `aud${n}-3@example.com`,
      role: 'rider',
    })
    .returning({ id: clubMembers.id });

  await testDb.db.insert(riderProfiles).values([
    { clubId, memberId: m1!.id, skillLevel: 'beginner' },
    { clubId, memberId: m2!.id, skillLevel: 'intermediate' },
    { clubId, memberId: m3!.id, skillLevel: 'advanced' },
  ]);

  const [lesson] = await testDb.db
    .insert(lessonTypes)
    .values({ clubId, name: 'Private', type: 'private', price: 10_000 })
    .returning({ id: lessonTypes.id });

  // One slot per booking — `(rider_member_id, slot_id)` is uniquely
  // indexed (no double-booking the same slot), so the 5 bookings for
  // m1 plus the 1 historical booking for m2 each need their own slot.
  async function createSlot(date: string, startTime: string): Promise<string> {
    const [s] = await testDb.db
      .insert(bookingSlots)
      .values({
        clubId,
        lessonTypeId: lesson!.id,
        date,
        startTime,
        endTime: '23:59:00',
        maxRiders: 99,
      })
      .returning({ id: bookingSlots.id });
    return s!.id;
  }

  // m1: 5 bookings on 5 distinct slots, all created `now()` (default).
  for (let i = 0; i < 5; i += 1) {
    const slotId = await createSlot('2026-05-01', `0${i + 1}:00:00`);
    await testDb.db.insert(bookings).values({
      clubId,
      slotId,
      riderMemberId: m1!.id,
      bookedByMemberId: m1!.id,
      amount: 10_000,
      paymentStatus: 'paid',
    });
  }

  // m2: 1 booking on its own slot, then back-date its created_at by
  // 200 days so the `activeWithinDays: 30` filter excludes it. The
  // overwrite is necessary because `created_at` defaults to `now()`
  // at insert and is not in the `bookings.$inferInsert` shape that
  // Drizzle exposes.
  const m2SlotId = await createSlot('2026-05-01', '08:00:00');
  const twoHundredDaysAgo = new Date(Date.now() - 200 * MS_PER_DAY);
  const [m2Booking] = await testDb.db
    .insert(bookings)
    .values({
      clubId,
      slotId: m2SlotId,
      riderMemberId: m2!.id,
      bookedByMemberId: m2!.id,
      amount: 10_000,
      paymentStatus: 'paid',
    })
    .returning({ id: bookings.id });
  await testDb.db.execute(
    sql`UPDATE bookings SET created_at = ${twoHundredDaysAgo} WHERE id = ${m2Booking!.id}`,
  );

  return {
    clubId,
    riderActiveBeginner: m1!.id,
    riderStaleIntermediate: m2!.id,
    riderNewAdvanced: m3!.id,
  };
}

describe('audience filter dead-key sanitisation (M-1 / migration 0032)', () => {
  it('migration 0032 strips hasActivePackage and tags from persisted jsonb', async () => {
    const seed = await seedClub();

    // Insert a row that still carries the dead keys. Bypass the TS
    // interface via the jsonb operator — this simulates a row written
    // by a previous schema version (or by anyone going around the API).
    await testDb.db.execute(sql`
      INSERT INTO audiences (club_id, name, filters)
      VALUES (
        ${seed.clubId},
        'Legacy audience with dead keys',
        ${JSON.stringify({
          skillLevel: 'beginner',
          minBookings: 1,
          hasActivePackage: true,
          tags: ['vip', 'monthly'],
        })}::jsonb
      )
    `);

    // Re-run the sanitisation step (the migration ran once at db boot;
    // re-running it has to be a no-op for clean rows and a one-shot
    // cleanup for dirty ones).
    await testDb.db.execute(sql`
      UPDATE audiences
         SET filters = (filters #- '{hasActivePackage}') #- '{tags}'
       WHERE filters ? 'hasActivePackage'
          OR filters ? 'tags'
    `);

    const rows = await testDb.db.select({ filters: audiences.filters }).from(audiences);
    expect(rows).toHaveLength(1);
    const filters = rows[0]!.filters as Record<string, unknown>;
    expect(filters).toEqual({ skillLevel: 'beginner', minBookings: 1 });
    expect('hasActivePackage' in filters).toBe(false);
    expect('tags' in filters).toBe(false);
  });

  it('sanitisation is idempotent — re-running on already-clean rows is a no-op', async () => {
    const seed = await seedClub();

    await testDb.db.execute(sql`
      INSERT INTO audiences (club_id, name, filters)
      VALUES (
        ${seed.clubId},
        'Already clean',
        ${JSON.stringify({ skillLevel: 'advanced' })}::jsonb
      )
    `);

    const beforeRows = await testDb.db
      .select({ filters: audiences.filters, updatedAt: audiences.updatedAt })
      .from(audiences);

    // Run the cleanup twice. The second run must not touch any row
    // (the WHERE clause filters to rows that still carry a dead key,
    // which the first run already handled).
    await testDb.db.execute(sql`
      UPDATE audiences
         SET filters = (filters #- '{hasActivePackage}') #- '{tags}'
       WHERE filters ? 'hasActivePackage'
          OR filters ? 'tags'
    `);
    await testDb.db.execute(sql`
      UPDATE audiences
         SET filters = (filters #- '{hasActivePackage}') #- '{tags}'
       WHERE filters ? 'hasActivePackage'
          OR filters ? 'tags'
    `);

    const afterRows = await testDb.db
      .select({ filters: audiences.filters, updatedAt: audiences.updatedAt })
      .from(audiences);
    expect(afterRows).toEqual(beforeRows);
  });
});

describe('audience resolver / batch-counter equivalence (M-1)', () => {
  it('skillLevel + minBookings + activeWithinDays produce identical results across paths', async () => {
    const seed = await seedClub();

    const cases = [
      {},
      { skillLevel: 'beginner' as const },
      { skillLevel: 'intermediate' as const },
      { minBookings: 1 },
      { minBookings: 5 },
      { activeWithinDays: 30 },
      { activeWithinDays: 365 },
      { skillLevel: 'beginner' as const, minBookings: 3 },
      { skillLevel: 'intermediate' as const, activeWithinDays: 30 },
    ];

    const batchCounts = await withTestDb(testDb.db, () =>
      countAudienceMembersBatch(seed.clubId, cases),
    );

    for (let i = 0; i < cases.length; i += 1) {
      const filters = cases[i]!;
      const oneShotCount = await withTestDb(testDb.db, () =>
        countAudienceMembers(seed.clubId, filters),
      );
      expect(batchCounts[i]).toBe(oneShotCount);
    }
  });

  it('resolver returns only active rider members of the requested club', async () => {
    const seed = await seedClub();
    const otherClub = await seedClub();

    const members = await withTestDb(testDb.db, () => resolveAudienceMembers(seed.clubId, {}));
    const memberIds = new Set(members.map((m) => m.id));
    expect(memberIds.has(seed.riderActiveBeginner)).toBe(true);
    expect(memberIds.has(seed.riderStaleIntermediate)).toBe(true);
    expect(memberIds.has(seed.riderNewAdvanced)).toBe(true);
    // Tenant scope: members from the other club do NOT leak in.
    expect(memberIds.has(otherClub.riderActiveBeginner)).toBe(false);
    expect(memberIds.has(otherClub.riderStaleIntermediate)).toBe(false);
    expect(memberIds.has(otherClub.riderNewAdvanced)).toBe(false);
  });

  it('skillLevel narrows correctly via the rider_profiles join', async () => {
    const seed = await seedClub();
    const beginners = await withTestDb(testDb.db, () =>
      resolveAudienceMembers(seed.clubId, { skillLevel: 'beginner' }),
    );
    expect(beginners.map((m) => m.id)).toEqual([seed.riderActiveBeginner]);
  });

  it('minBookings excludes riders below the threshold', async () => {
    const seed = await seedClub();
    const fiveOrMore = await withTestDb(testDb.db, () =>
      resolveAudienceMembers(seed.clubId, { minBookings: 5 }),
    );
    expect(fiveOrMore.map((m) => m.id)).toEqual([seed.riderActiveBeginner]);
  });

  it('activeWithinDays drops riders whose latest booking is older than the window', async () => {
    const seed = await seedClub();
    const recent = await withTestDb(testDb.db, () =>
      resolveAudienceMembers(seed.clubId, { activeWithinDays: 30 }),
    );
    const recentIds = new Set(recent.map((m) => m.id));
    expect(recentIds.has(seed.riderActiveBeginner)).toBe(true);
    // Stale + new (no bookings) both excluded.
    expect(recentIds.has(seed.riderStaleIntermediate)).toBe(false);
    expect(recentIds.has(seed.riderNewAdvanced)).toBe(false);
  });
});
