import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { getActiveMembershipsForUser } from '../queries/horses';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

/**
 * Integration tests for the multi-club membership resolver — audit AI-22.
 *
 * Riders can belong to multiple stables; the active club is selected via
 * the `cavaliq_active_club` cookie (resolved in `tenant.ts`). The DB-side
 * helper `getActiveMembershipsForUser` is the source of truth for "which
 * clubs can this user switch to" and must:
 *
 *   1. Return only `is_active = true` memberships.
 *   2. Hide tombstoned (soft-deleted) clubs.
 *   3. Return one row per (user, club), even when the rider has multiple
 *      role rows in the same club (shouldn't happen, but defence).
 *   4. Order results stably so the "primary" club selection at the
 *      tenant.ts fallback path is deterministic.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedMembership(
  db: typeof testDb.db,
  opts: {
    clubName: string;
    clerkUserId: string;
    isActive?: boolean;
    clubDeleted?: boolean;
    role?: 'rider' | 'horse_owner' | 'parent' | 'club_admin';
  },
) {
  const slug = opts.clubName.toLowerCase().replace(/\W+/g, '-');
  const [club] = await db
    .insert(clubs)
    .values({
      name: opts.clubName,
      slug,
      clerkOrgId: `org_${slug}`,
      deletedAt: opts.clubDeleted ? new Date() : null,
    })
    .returning({ id: clubs.id });
  const [member] = await db
    .insert(clubMembers)
    .values({
      clubId: club!.id,
      clerkUserId: opts.clerkUserId,
      email: `${opts.clerkUserId}@example.com`,
      role: opts.role ?? 'rider',
      isActive: opts.isActive ?? true,
    })
    .returning({ id: clubMembers.id });
  return { clubId: club!.id, memberId: member!.id };
}

describe('getActiveMembershipsForUser', () => {
  it('returns every active membership for a multi-club rider', async () => {
    await seedMembership(testDb.db, { clubName: 'Alpha Stables', clerkUserId: 'user_multi' });
    await seedMembership(testDb.db, { clubName: 'Beta Stables', clerkUserId: 'user_multi' });
    await seedMembership(testDb.db, { clubName: 'Gamma Stables', clerkUserId: 'user_multi' });

    const memberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_multi'),
    );

    expect(memberships).toHaveLength(3);
    const clubNames = memberships.map((m) => m.clubName);
    expect(clubNames).toEqual(['Alpha Stables', 'Beta Stables', 'Gamma Stables']);
  });

  it('hides memberships marked is_active=false', async () => {
    await seedMembership(testDb.db, { clubName: 'Active Club', clerkUserId: 'user_inactive' });
    await seedMembership(testDb.db, {
      clubName: 'Inactive Club',
      clerkUserId: 'user_inactive',
      isActive: false,
    });

    const memberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_inactive'),
    );

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.clubName).toBe('Active Club');
  });

  it('hides memberships from soft-deleted clubs (post-org.deleted webhook)', async () => {
    await seedMembership(testDb.db, { clubName: 'Live Club', clerkUserId: 'user_tomb' });
    await seedMembership(testDb.db, {
      clubName: 'Tombstoned Club',
      clerkUserId: 'user_tomb',
      clubDeleted: true,
    });

    const memberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_tomb'),
    );

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.clubName).toBe('Live Club');
  });

  it('does not leak memberships across users (tenant isolation)', async () => {
    await seedMembership(testDb.db, { clubName: 'Alice Club', clerkUserId: 'user_alice' });
    await seedMembership(testDb.db, { clubName: 'Bob Club', clerkUserId: 'user_bob' });

    const aliceMemberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_alice'),
    );
    const bobMemberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_bob'),
    );

    expect(aliceMemberships).toHaveLength(1);
    expect(aliceMemberships[0]?.clubName).toBe('Alice Club');
    expect(bobMemberships).toHaveLength(1);
    expect(bobMemberships[0]?.clubName).toBe('Bob Club');
  });

  it('returns empty for a user with no memberships', async () => {
    await seedMembership(testDb.db, { clubName: 'Some Club', clerkUserId: 'user_other' });

    const memberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_no_memberships'),
    );

    expect(memberships).toEqual([]);
  });

  it('orders by club name for stable primary-club selection', async () => {
    // The tenant.ts fallback picks `memberships[0]` as the primary when no
    // active-club cookie is set — order must be deterministic so a multi-
    // club rider lands on the same club every session.
    await seedMembership(testDb.db, { clubName: 'Zulu Stables', clerkUserId: 'user_order' });
    await seedMembership(testDb.db, { clubName: 'Alpha Stables', clerkUserId: 'user_order' });
    await seedMembership(testDb.db, { clubName: 'Mike Stables', clerkUserId: 'user_order' });

    const memberships = await withTestDb(testDb.db, () =>
      getActiveMembershipsForUser('user_order'),
    );

    expect(memberships.map((m) => m.clubName)).toEqual([
      'Alpha Stables',
      'Mike Stables',
      'Zulu Stables',
    ]);
  });
});
