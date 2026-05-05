import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { riderProfiles, clubMembers, clubs } from '../schema';
import { isParentOf, getDependentMemberIds } from '../queries/riders';

/**
 * Regression coverage for the parent-role authorization helpers used by
 * the booking POST and payment-init routes. The audit's HIGH-1/HIGH-2
 * findings were that parents were accepted at the permission gate but
 * blocked in the body — the inline checks now call `isParentOf` to
 * verify the rider is recorded as the caller's dependent on
 * `rider_profiles.parent_member_id` (the existing schema column from
 * audit H-7).
 *
 * Failure modes worth gating:
 *   1. Self → not a parent of yourself.
 *   2. Different rider, no link → false.
 *   3. Linked rider in same club → true.
 *   4. Linked rider in *another* club → false (tenant isolation).
 *   5. Linked rider whose profile was deleted → false.
 *
 * `getDependentMemberIds` is the reverse lookup; gating it here ensures
 * the parent's GET path doesn't accidentally surface a rider from a
 * different club via the same FK relation.
 */
describe('isParentOf', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  afterEach(async () => {
    if (testDb) await testDb.close();
  });

  async function setup() {
    testDb = await createTestDb();

    const [clubA] = await testDb.db
      .insert(clubs)
      .values({
        name: 'Alpha Stables',
        slug: `alpha-${Date.now()}`,
        clerkOrgId: `org_alpha_${Date.now()}`,
      })
      .returning();
    const [clubB] = await testDb.db
      .insert(clubs)
      .values({
        name: 'Beta Stables',
        slug: `beta-${Date.now()}`,
        clerkOrgId: `org_beta_${Date.now()}`,
      })
      .returning();
    if (!clubA || !clubB) throw new Error('club insert failed');

    const [parent] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: clubA.id,
        clerkUserId: `user_parent_${Date.now()}`,
        role: 'parent',
        displayName: 'Parent A',
      })
      .returning();
    const [child] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: clubA.id,
        clerkUserId: `user_child_${Date.now()}`,
        role: 'rider',
        displayName: 'Child A',
      })
      .returning();
    const [stranger] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: clubA.id,
        clerkUserId: `user_stranger_${Date.now()}`,
        role: 'rider',
        displayName: 'Stranger A',
      })
      .returning();
    const [otherClubChild] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: clubB.id,
        clerkUserId: `user_otherchild_${Date.now()}`,
        role: 'rider',
        displayName: 'Child B',
      })
      .returning();
    if (!parent || !child || !stranger || !otherClubChild) {
      throw new Error('member insert failed');
    }

    // Child has a rider profile linked to the parent.
    await testDb.db.insert(riderProfiles).values({
      clubId: clubA.id,
      memberId: child.id,
      skillLevel: 'beginner',
      parentMemberId: parent.id,
    });

    // Stranger has a rider profile but no parent link.
    await testDb.db.insert(riderProfiles).values({
      clubId: clubA.id,
      memberId: stranger.id,
      skillLevel: 'beginner',
    });

    return {
      clubAId: clubA.id,
      clubBId: clubB.id,
      parentMemberId: parent.id,
      childMemberId: child.id,
      strangerMemberId: stranger.id,
      otherClubChildId: otherClubChild.id,
    };
  }

  it('returns true when the child is linked to the parent in the same club', async () => {
    const { clubAId, parentMemberId, childMemberId } = await setup();
    const result = await withTestDb(testDb.db, () =>
      isParentOf(clubAId, parentMemberId, childMemberId),
    );
    expect(result).toBe(true);
  });

  it('returns false when the rider has no parent link', async () => {
    const { clubAId, parentMemberId, strangerMemberId } = await setup();
    const result = await withTestDb(testDb.db, () =>
      isParentOf(clubAId, parentMemberId, strangerMemberId),
    );
    expect(result).toBe(false);
  });

  it('returns false when the rider has no rider profile', async () => {
    const { clubAId, parentMemberId } = await setup();
    // Insert a fresh member with no rider_profiles row.
    const [orphan] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: clubAId,
        clerkUserId: `user_orphan_${Date.now()}`,
        role: 'rider',
      })
      .returning();
    const result = await withTestDb(testDb.db, () =>
      isParentOf(clubAId, parentMemberId, orphan!.id),
    );
    expect(result).toBe(false);
  });

  it('returns false when the parentMemberId equals childMemberId', async () => {
    const { clubAId, parentMemberId } = await setup();
    const result = await withTestDb(testDb.db, () =>
      isParentOf(clubAId, parentMemberId, parentMemberId),
    );
    expect(result).toBe(false);
  });

  it('does not match a child whose profile lives in another club', async () => {
    // Forged-tenant scenario: an attacker passes the parent's clubId AND a
    // memberId whose rider_profile is in a different club. `isParentOf`
    // must scope by clubId — the FK alone is single-column and would NOT
    // catch this without the `eq(clubId)` filter.
    const { clubAId, parentMemberId, otherClubChildId } = await setup();
    const result = await withTestDb(testDb.db, () =>
      isParentOf(clubAId, parentMemberId, otherClubChildId),
    );
    expect(result).toBe(false);
  });
});

describe('getDependentMemberIds', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  afterEach(async () => {
    if (testDb) await testDb.close();
  });

  it('returns every rider linked to the given parent in this club', async () => {
    testDb = await createTestDb();

    const [club] = await testDb.db
      .insert(clubs)
      .values({
        name: 'Multi-child Stables',
        slug: `multi-${Date.now()}`,
        clerkOrgId: `org_multi_${Date.now()}`,
      })
      .returning();

    const [parent] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club!.id,
        clerkUserId: `user_p_${Date.now()}`,
        role: 'parent',
      })
      .returning();
    const [child1] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club!.id,
        clerkUserId: `user_c1_${Date.now()}`,
        role: 'rider',
      })
      .returning();
    const [child2] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club!.id,
        clerkUserId: `user_c2_${Date.now()}`,
        role: 'rider',
      })
      .returning();
    const [unrelated] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club!.id,
        clerkUserId: `user_u_${Date.now()}`,
        role: 'rider',
      })
      .returning();

    await testDb.db.insert(riderProfiles).values([
      { clubId: club!.id, memberId: child1!.id, skillLevel: 'beginner', parentMemberId: parent!.id },
      { clubId: club!.id, memberId: child2!.id, skillLevel: 'beginner', parentMemberId: parent!.id },
      { clubId: club!.id, memberId: unrelated!.id, skillLevel: 'beginner' },
    ]);

    const ids = await withTestDb(testDb.db, () =>
      getDependentMemberIds(club!.id, parent!.id),
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([child1!.id, child2!.id]));
  });

  it('returns an empty array when the parent has no dependents', async () => {
    testDb = await createTestDb();

    const [club] = await testDb.db
      .insert(clubs)
      .values({
        name: 'Lonely Stables',
        slug: `lonely-${Date.now()}`,
        clerkOrgId: `org_lonely_${Date.now()}`,
      })
      .returning();
    const [parent] = await testDb.db
      .insert(clubMembers)
      .values({
        clubId: club!.id,
        clerkUserId: `user_lonely_${Date.now()}`,
        role: 'parent',
      })
      .returning();

    const ids = await withTestDb(testDb.db, () =>
      getDependentMemberIds(club!.id, parent!.id),
    );

    expect(ids).toEqual([]);
  });
});
