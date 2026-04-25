import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import {
  getHorseById,
  getMedicationByIds,
  getCompetitionClassById,
} from '../queries';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';
import {
  horseMedications,
  horseHealthRecords,
  horseMedicationLogs,
  horseFeedingPlans,
  horseExerciseSchedules,
  horseDocuments,
} from '../schema/horse-health';
import { competitions, competitionClasses } from '../schema/competitions';

/**
 * Tests for the existence-and-binding helpers that the route layer uses
 * to close the cross-tenant write paths flagged in the 2026-04 audit.
 *
 * The horse sub-resource POSTs (medications, health, feeding, exercise,
 * documents, medication logs) and the competition class PATCH/DELETE all
 * accepted UUIDs from the URL and inserted with `(ctx.clubId, urlParam)`
 * without verifying the resource was in the caller's tenant. The fix
 * binds the URL params to the tenant via these helpers BEFORE the write.
 *
 * These tests verify the helpers reject cross-tenant lookups so the
 * route-layer `if (!resource) return 404` short-circuit fires correctly.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

interface TwoClubs {
  clubA: string;
  clubB: string;
  horseA: string;
  horseB: string;
  medicationA: string;
  competitionA: string;
  classA: string;
}

async function seedTwoClubsWithResources(db: typeof testDb.db): Promise<TwoClubs> {
  const [clubA] = await db
    .insert(clubs)
    .values({ name: 'Alpha Club', slug: 'alpha-tb', clerkOrgId: 'org_alpha_tb' })
    .returning({ id: clubs.id });
  const [clubB] = await db
    .insert(clubs)
    .values({ name: 'Bravo Club', slug: 'bravo-tb', clerkOrgId: 'org_bravo_tb' })
    .returning({ id: clubs.id });

  await db.insert(clubMembers).values({
    clubId: clubA!.id,
    clerkUserId: 'user_alpha_tb',
    email: 'a@tb.example.com',
    role: 'club_admin',
  });
  await db.insert(clubMembers).values({
    clubId: clubB!.id,
    clerkUserId: 'user_bravo_tb',
    email: 'b@tb.example.com',
    role: 'club_admin',
  });

  const [horseA] = await db
    .insert(horses)
    .values({ clubId: clubA!.id, name: 'Spirit' })
    .returning({ id: horses.id });
  const [horseB] = await db
    .insert(horses)
    .values({ clubId: clubB!.id, name: 'Comet' })
    .returning({ id: horses.id });

  const [medicationA] = await db
    .insert(horseMedications)
    .values({
      clubId: clubA!.id,
      horseId: horseA!.id,
      medicationName: 'Bute',
      dosage: '2g',
      frequency: 'daily',
      startDate: '2026-04-20',
    })
    .returning({ id: horseMedications.id });

  const [competitionA] = await db
    .insert(competitions)
    .values({
      clubId: clubA!.id,
      name: 'Spring Show',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    })
    .returning({ id: competitions.id });

  const [classA] = await db
    .insert(competitionClasses)
    .values({
      clubId: clubA!.id,
      competitionId: competitionA!.id,
      name: '1m Jumping',
    })
    .returning({ id: competitionClasses.id });

  return {
    clubA: clubA!.id,
    clubB: clubB!.id,
    horseA: horseA!.id,
    horseB: horseB!.id,
    medicationA: medicationA!.id,
    competitionA: competitionA!.id,
    classA: classA!.id,
  };
}

describe('getHorseById — tenant binding', () => {
  it('returns the horse when (clubId, horseId) match', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getHorseById(seeded.clubA, seeded.horseA),
    );
    expect(result?.id).toBe(seeded.horseA);
  });

  it('returns null when horse is in another club — guards POST /horses/:id/medications etc', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getHorseById(seeded.clubB, seeded.horseA),
    );
    expect(result).toBeNull();
  });

  it('returns null for an unknown horseId', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getHorseById(seeded.clubA, '00000000-0000-0000-0000-000000000000'),
    );
    expect(result).toBeNull();
  });
});

describe('getMedicationByIds — three-way binding', () => {
  it('returns the medication when (clubId, horseId, medicationId) all match', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getMedicationByIds(seeded.clubA, seeded.horseA, seeded.medicationA),
    );
    expect(result?.id).toBe(seeded.medicationA);
  });

  it('returns null when the medication belongs to another club', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getMedicationByIds(seeded.clubB, seeded.horseA, seeded.medicationA),
    );
    expect(result).toBeNull();
  });

  it('returns null when horseId in URL does not match the medication`s horse', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getMedicationByIds(seeded.clubA, seeded.horseB, seeded.medicationA),
    );
    expect(result).toBeNull();
  });

  it('returns null for an unknown medicationId', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getMedicationByIds(
        seeded.clubA,
        seeded.horseA,
        '00000000-0000-0000-0000-000000000000',
      ),
    );
    expect(result).toBeNull();
  });
});

describe('getCompetitionClassById — tenant binding', () => {
  it('returns the class when (clubId, classId) match', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionClassById(seeded.clubA, seeded.classA),
    );
    expect(result?.id).toBe(seeded.classA);
    expect(result?.competitionId).toBe(seeded.competitionA);
  });

  it('returns null when class is in another club', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionClassById(seeded.clubB, seeded.classA),
    );
    expect(result).toBeNull();
  });

  it('returns null for an unknown classId', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    const result = await withTestDb(testDb.db, () =>
      getCompetitionClassById(seeded.clubA, '00000000-0000-0000-0000-000000000000'),
    );
    expect(result).toBeNull();
  });
});

/**
 * Schema-level enforcement (migration 0017): the composite FK
 * (horse_id, club_id) -> horses(id, club_id) on every horse sub-resource
 * table makes a mismatched-tenant insert fail at the DB layer. This is
 * defence in depth — the route-level getHorseById precheck shipped first;
 * these tests cover the case where a future handler omits the precheck.
 */
describe('composite FK on horse sub-tables — DB rejects mismatched tenant', () => {
  it('horse_health_records insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseHealthRecords).values({
        clubId: seeded.clubB, // foreign club
        horseId: seeded.horseA, // belongs to clubA
        recordType: 'vaccination',
        title: 'Tetanus',
        date: '2026-04-26',
      }),
    ).rejects.toThrow();
  });

  it('horse_medications insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseMedications).values({
        clubId: seeded.clubB,
        horseId: seeded.horseA,
        medicationName: 'X',
        dosage: '1g',
        frequency: 'daily',
        startDate: '2026-04-26',
      }),
    ).rejects.toThrow();
  });

  it('horse_medication_logs insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseMedicationLogs).values({
        clubId: seeded.clubB,
        horseId: seeded.horseA,
        medicationId: seeded.medicationA,
        administeredAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('horse_feeding_plans insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseFeedingPlans).values({
        clubId: seeded.clubB,
        horseId: seeded.horseA,
        mealName: 'Morning',
      }),
    ).rejects.toThrow();
  });

  it('horse_exercise_schedules insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseExerciseSchedules).values({
        clubId: seeded.clubB,
        horseId: seeded.horseA,
        dayOfWeek: 1,
        exerciseType: 'flatwork',
      }),
    ).rejects.toThrow();
  });

  it('horse_documents insert with foreign clubId fails', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseDocuments).values({
        clubId: seeded.clubB,
        horseId: seeded.horseA,
        fileName: 'x.pdf',
        fileUrl: 'https://r2.example.com/x.pdf',
      }),
    ).rejects.toThrow();
  });

  it('insert with matching (clubId, horseId) succeeds — sanity check', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    await expect(
      testDb.db.insert(horseFeedingPlans).values({
        clubId: seeded.clubA,
        horseId: seeded.horseA,
        mealName: 'Morning',
      }),
    ).resolves.toBeDefined();
  });

  it('deleting a horse cascades to sub-resources via the composite FK', async () => {
    const seeded = await seedTwoClubsWithResources(testDb.db);
    // medicationA was seeded against horseA — it should disappear when
    // horseA is deleted, via ON DELETE CASCADE on the composite FK.
    const before = await testDb.db.select().from(horseMedications);
    expect(before.find((m) => m.id === seeded.medicationA)).toBeDefined();

    const { eq } = await import('drizzle-orm');
    await testDb.db.delete(horses).where(eq(horses.id, seeded.horseA));

    const after = await testDb.db.select().from(horseMedications);
    expect(after.find((m) => m.id === seeded.medicationA)).toBeUndefined();
  });
});
