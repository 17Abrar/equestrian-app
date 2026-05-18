import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import {
  getBookingById,
  findBookingByIdForWebhook,
  getBookingSlotById,
  getHorseById,
  getRiderById,
  getRiderByMemberId,
  getMemberById,
  getArenaById,
  getLessonTypeById,
  getExpenseById,
  getAudienceById,
  getCompetitionById,
  getCompetitionEntryById,
} from '../queries';
import { bookings, bookingSlots, lessonTypes, arenas } from '../schema/bookings';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';
import { riderProfiles } from '../schema/rider-profiles';
import { expenses } from '../schema/finances';
import { audiences } from '../schema/audiences';
import { competitions, competitionClasses, competitionEntries } from '../schema/competitions';

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
  lessonA: string;
  lessonB: string;
  slotA: string;
  slotB: string;
  bookingA: string;
  bookingB: string;
  /** Audit L4 (2026-05-18) extensions. */
  horseA: string;
  horseB: string;
  riderA: string;
  riderB: string;
  arenaA: string;
  arenaB: string;
  expenseA: string;
  expenseB: string;
  audienceA: string;
  audienceB: string;
  competitionA: string;
  competitionB: string;
  classA: string;
  classB: string;
  entryA: string;
  entryB: string;
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

  // ─── Audit L4 (2026-05-18) — extend coverage to the byId helpers the
  //     audit pass identified as missing from this canonical test. Each
  //     entity below is seeded once per club so subsequent `byId(clubA,
  //     entityB)` calls have a real cross-tenant target to attempt
  //     against.

  const [horseA] = await db
    .insert(horses)
    .values({ clubId: clubA!.id, name: 'Spirit A' })
    .returning({ id: horses.id });
  const [horseB] = await db
    .insert(horses)
    .values({ clubId: clubB!.id, name: 'Spirit B' })
    .returning({ id: horses.id });

  const [riderA] = await db
    .insert(riderProfiles)
    .values({
      clubId: clubA!.id,
      memberId: memberA!.id,
      skillLevel: 'beginner',
    })
    .returning({ id: riderProfiles.id });
  const [riderB] = await db
    .insert(riderProfiles)
    .values({
      clubId: clubB!.id,
      memberId: memberB!.id,
      skillLevel: 'beginner',
    })
    .returning({ id: riderProfiles.id });

  const [arenaA] = await db
    .insert(arenas)
    .values({ clubId: clubA!.id, name: 'Indoor A', capacity: 10 })
    .returning({ id: arenas.id });
  const [arenaB] = await db
    .insert(arenas)
    .values({ clubId: clubB!.id, name: 'Indoor B', capacity: 10 })
    .returning({ id: arenas.id });

  const [expenseA] = await db
    .insert(expenses)
    .values({
      clubId: clubA!.id,
      category: 'feed',
      amount: 5000,
      currency: 'AED',
      date: '2026-05-01',
      description: 'Hay bales A',
    })
    .returning({ id: expenses.id });
  const [expenseB] = await db
    .insert(expenses)
    .values({
      clubId: clubB!.id,
      category: 'feed',
      amount: 5000,
      currency: 'AED',
      date: '2026-05-01',
      description: 'Hay bales B',
    })
    .returning({ id: expenses.id });

  const [audienceA] = await db
    .insert(audiences)
    .values({
      clubId: clubA!.id,
      name: 'Active riders A',
      filters: {},
    })
    .returning({ id: audiences.id });
  const [audienceB] = await db
    .insert(audiences)
    .values({
      clubId: clubB!.id,
      name: 'Active riders B',
      filters: {},
    })
    .returning({ id: audiences.id });

  const [competitionA] = await db
    .insert(competitions)
    .values({
      clubId: clubA!.id,
      name: 'Spring Show A',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    })
    .returning({ id: competitions.id });
  const [competitionB] = await db
    .insert(competitions)
    .values({
      clubId: clubB!.id,
      name: 'Spring Show B',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    })
    .returning({ id: competitions.id });

  const [classA] = await db
    .insert(competitionClasses)
    .values({
      clubId: clubA!.id,
      competitionId: competitionA!.id,
      name: 'Novice A',
    })
    .returning({ id: competitionClasses.id });
  const [classB] = await db
    .insert(competitionClasses)
    .values({
      clubId: clubB!.id,
      competitionId: competitionB!.id,
      name: 'Novice B',
    })
    .returning({ id: competitionClasses.id });

  const [entryA] = await db
    .insert(competitionEntries)
    .values({
      clubId: clubA!.id,
      classId: classA!.id,
      riderMemberId: memberA!.id,
    })
    .returning({ id: competitionEntries.id });
  const [entryB] = await db
    .insert(competitionEntries)
    .values({
      clubId: clubB!.id,
      classId: classB!.id,
      riderMemberId: memberB!.id,
    })
    .returning({ id: competitionEntries.id });

  return {
    clubA: clubA!.id,
    clubB: clubB!.id,
    memberA: memberA!.id,
    memberB: memberB!.id,
    lessonA: lessonA!.id,
    lessonB: lessonB!.id,
    slotA: slotA!.id,
    slotB: slotB!.id,
    bookingA: bookingA!.id,
    bookingB: bookingB!.id,
    horseA: horseA!.id,
    horseB: horseB!.id,
    riderA: riderA!.id,
    riderB: riderB!.id,
    arenaA: arenaA!.id,
    arenaB: arenaB!.id,
    expenseA: expenseA!.id,
    expenseB: expenseB!.id,
    audienceA: audienceA!.id,
    audienceB: audienceB!.id,
    competitionA: competitionA!.id,
    competitionB: competitionB!.id,
    classA: classA!.id,
    classB: classB!.id,
    entryA: entryA!.id,
    entryB: entryB!.id,
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

// ─── Audit L4 (2026-05-18 audit pass) ─────────────────────────────────
// The original canonical test covered only `bookings`. CLAUDE.md
// rule #11 ("EVERY query MUST include the club_id tenant scope")
// applies to every `byId` helper in `packages/db/src/queries/**`;
// the audit identified ~17 helpers without explicit cross-tenant
// assertions. The describe blocks below add the same two-assertion
// pattern (same-tenant returns the row, cross-tenant returns null)
// for the highest-leverage helpers — those used on mutation paths
// or fetching PHI / settings rows where a leak would be material.
// ──────────────────────────────────────────────────────────────────────

describe('tenant isolation — booking slots', () => {
  it('getBookingSlotById(clubA, slotA) returns the slot', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getBookingSlotById(seeded.clubA, seeded.slotA),
    );
    expect(result?.id).toBe(seeded.slotA);
  });

  it('getBookingSlotById(clubA, slotB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getBookingSlotById(seeded.clubA, seeded.slotB),
    );
    expect(result).toBeNull();
  });
});

describe('tenant isolation — horses', () => {
  it('getHorseById(clubA, horseA) returns the horse', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getHorseById(seeded.clubA, seeded.horseA));
    expect(result?.id).toBe(seeded.horseA);
  });

  it('getHorseById(clubA, horseB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getHorseById(seeded.clubA, seeded.horseB));
    expect(result).toBeNull();
  });
});

describe('tenant isolation — riders', () => {
  it('getRiderById(clubA, riderA) returns the rider', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getRiderById(seeded.clubA, seeded.riderA));
    expect(result?.id).toBe(seeded.riderA);
  });

  it('getRiderById(clubA, riderB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getRiderById(seeded.clubA, seeded.riderB));
    expect(result).toBeNull();
  });

  it('getRiderByMemberId(clubA, memberA) returns the rider', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getRiderByMemberId(seeded.clubA, seeded.memberA),
    );
    expect(result?.memberId).toBe(seeded.memberA);
  });

  it('getRiderByMemberId(clubA, memberB) returns null — cross-tenant read blocked', async () => {
    // memberB exists in clubB but the helper must reject when the
    // active club scope (clubA) doesn't match the row's tenant.
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getRiderByMemberId(seeded.clubA, seeded.memberB),
    );
    expect(result).toBeNull();
  });
});

describe('tenant isolation — members', () => {
  it('getMemberById(clubA, memberA) returns the member', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getMemberById(seeded.clubA, seeded.memberA));
    expect(result?.id).toBe(seeded.memberA);
  });

  it('getMemberById(clubA, memberB) returns null — cross-tenant read blocked', async () => {
    // The risk: a future write path that resolves a memberId from a
    // less-trusted source (URL, webhook payload metadata) could
    // otherwise mutate a foreign-club member.
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getMemberById(seeded.clubA, seeded.memberB));
    expect(result).toBeNull();
  });
});

describe('tenant isolation — arenas', () => {
  it('getArenaById(clubA, arenaA) returns the arena', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getArenaById(seeded.clubA, seeded.arenaA));
    expect(result?.id).toBe(seeded.arenaA);
  });

  it('getArenaById(clubA, arenaB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getArenaById(seeded.clubA, seeded.arenaB));
    expect(result).toBeNull();
  });
});

describe('tenant isolation — lesson types', () => {
  it('getLessonTypeById(clubA, lessonA) returns the lesson type', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getLessonTypeById(seeded.clubA, seeded.lessonA),
    );
    expect(result?.id).toBe(seeded.lessonA);
  });

  it('getLessonTypeById(clubA, lessonB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getLessonTypeById(seeded.clubA, seeded.lessonB),
    );
    expect(result).toBeNull();
  });
});

describe('tenant isolation — expenses', () => {
  it('getExpenseById(clubA, expenseA) returns the expense', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getExpenseById(seeded.clubA, seeded.expenseA));
    expect(result?.id).toBe(seeded.expenseA);
  });

  it('getExpenseById(clubA, expenseB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () => getExpenseById(seeded.clubA, seeded.expenseB));
    expect(result).toBeNull();
  });
});

describe('tenant isolation — audiences', () => {
  it('getAudienceById(clubA, audienceA) returns the audience', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getAudienceById(seeded.clubA, seeded.audienceA),
    );
    expect(result?.id).toBe(seeded.audienceA);
  });

  it('getAudienceById(clubA, audienceB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getAudienceById(seeded.clubA, seeded.audienceB),
    );
    expect(result).toBeNull();
  });
});

describe('tenant isolation — competitions', () => {
  it('getCompetitionById(clubA, competitionA) returns the competition', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionById(seeded.clubA, seeded.competitionA),
    );
    expect(result?.id).toBe(seeded.competitionA);
  });

  it('getCompetitionById(clubA, competitionB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionById(seeded.clubA, seeded.competitionB),
    );
    expect(result).toBeNull();
  });

  it('getCompetitionEntryById(clubA, entryA) returns the entry', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionEntryById(seeded.clubA, seeded.entryA),
    );
    expect(result?.id).toBe(seeded.entryA);
  });

  it('getCompetitionEntryById(clubA, entryB) returns null — cross-tenant read blocked', async () => {
    const seeded = await seedTwoClubs(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionEntryById(seeded.clubA, seeded.entryB),
    );
    expect(result).toBeNull();
  });
});
