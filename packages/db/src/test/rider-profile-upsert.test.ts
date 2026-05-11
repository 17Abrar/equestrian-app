import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import { riderProfiles, clubMembers, clubs } from '../schema';
import { upsertRiderProfileByMember } from '../queries/riders';

/**
 * Verifies the HIGH-7 fix: `upsertRiderProfileByMember` was previously
 * a SELECT-then-INSERT path that raced under concurrent first-time
 * saves (two requests both saw `existing = []` and both INSERT'd,
 * leaving the rider with two profile rows).
 *
 * The fix added a unique index on (club_id, member_id) and rewrote
 * the function as INSERT ... ON CONFLICT DO UPDATE. These tests
 * confirm both halves: that the constraint exists, and that the
 * single round-trip is idempotent + race-safe.
 */

describe('upsertRiderProfileByMember', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  afterEach(async () => {
    if (testDb) await testDb.close();
  });

  async function setup() {
    testDb = await createTestDb();

    const [club] = await testDb.db
      .insert(clubs)
      .values({
        name: 'Test Club',
        slug: `t-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        clerkOrgId: `org_${Date.now()}`,
      })
      .returning();
    if (!club) throw new Error('club insert returned no row');

    const [member] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club.id,
        clerkUserId: `user_test_${Date.now()}`,
        role: 'rider',
        displayName: 'Test Rider',
      })
      .returning();
    if (!member) throw new Error('member insert returned no row');

    return { clubId: club.id, memberId: member.id };
  }

  it('first call inserts a new profile', async () => {
    const { clubId, memberId } = await setup();

    const result = await withTestDb(testDb.db, async () => {
      return upsertRiderProfileByMember(clubId, memberId, {
        skillLevel: 'intermediate',
        weightKg: 70,
        heightCm: 175,
      });
    });

    expect(result).not.toBeNull();
    expect(result!.skillLevel).toBe('intermediate');
    expect(Number(result!.weightKg)).toBe(70);
    expect(Number(result!.heightCm)).toBe(175);

    const rows = await testDb.db
      .select()
      .from(riderProfiles)
      .where(eq(riderProfiles.memberId, memberId));
    expect(rows).toHaveLength(1);
  });

  it('second call updates the same row (no duplicate)', async () => {
    const { clubId, memberId } = await setup();

    await withTestDb(testDb.db, async () => {
      await upsertRiderProfileByMember(clubId, memberId, {
        skillLevel: 'beginner',
      });
    });

    const updated = await withTestDb(testDb.db, async () => {
      return upsertRiderProfileByMember(clubId, memberId, {
        skillLevel: 'advanced',
        weightKg: 65,
      });
    });

    expect(updated!.skillLevel).toBe('advanced');
    expect(Number(updated!.weightKg)).toBe(65);

    const rows = await testDb.db
      .select()
      .from(riderProfiles)
      .where(eq(riderProfiles.memberId, memberId));
    expect(rows).toHaveLength(1);
  });

  it('concurrent first-time upserts produce exactly one row', async () => {
    const { clubId, memberId } = await setup();

    const results = await Promise.all([
      withTestDb(testDb.db, () =>
        upsertRiderProfileByMember(clubId, memberId, { skillLevel: 'beginner' }),
      ),
      withTestDb(testDb.db, () =>
        upsertRiderProfileByMember(clubId, memberId, { skillLevel: 'intermediate' }),
      ),
      withTestDb(testDb.db, () =>
        upsertRiderProfileByMember(clubId, memberId, { skillLevel: 'advanced' }),
      ),
    ]);

    for (const r of results) {
      expect(r).not.toBeNull();
    }

    const rows = await testDb.db
      .select()
      .from(riderProfiles)
      .where(eq(riderProfiles.memberId, memberId));
    expect(rows).toHaveLength(1);
  });

  it('omitted fields preserve existing values (PATCH semantics)', async () => {
    const { clubId, memberId } = await setup();

    await withTestDb(testDb.db, async () => {
      await upsertRiderProfileByMember(clubId, memberId, {
        skillLevel: 'intermediate',
        weightKg: 70,
        heightCm: 175,
      });
    });

    const updated = await withTestDb(testDb.db, async () => {
      return upsertRiderProfileByMember(clubId, memberId, {
        weightKg: 75,
      });
    });

    expect(updated!.skillLevel).toBe('intermediate');
    expect(Number(updated!.weightKg)).toBe(75);
    expect(Number(updated!.heightCm)).toBe(175);
  });
});
