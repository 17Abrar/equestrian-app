import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import {
  joinClubInstantly,
  isUserMember,
} from '../queries/discovery';
import { deactivateMember } from '../queries/club-members';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';

/**
 * Integration tests for the rider signup / join flow — audit AI-22.
 *
 * Closes the test gap on the open-club instant-join path:
 *   1. Idempotent on (club_id, clerk_user_id) — duplicate POST from
 *      double-click or retry must not 500 with a 23505.
 *   2. Reactivates a previously-left member (is_active=false) instead of
 *      throwing on the unique index.
 *   3. Concurrent join attempts from the same user resolve to a single
 *      membership row.
 *   4. `isUserMember` correctly hides inactive memberships from the
 *      pre-join short-circuit so a left-then-rejoining user isn't
 *      blocked by a stale row.
 *   5. Audit J-1 — an admin-kicked member (deactivatedByAdminAt != null)
 *      cannot rejoin via this path. Returns {status:'kicked'}.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedClub(db: typeof testDb.db, slug: string) {
  const [club] = await db
    .insert(clubs)
    .values({
      name: `Club ${slug}`,
      slug,
      clerkOrgId: `org_${slug}`,
      joinPolicy: 'open',
      isPublicListing: true,
    })
    .returning({ id: clubs.id });
  return club!.id;
}

describe('joinClubInstantly', () => {
  it('creates a fresh active membership for a first-time joiner', async () => {
    const clubId = await seedClub(testDb.db, 'first-time');

    const result = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_first',
        email: 'first@example.com',
        displayName: 'First User',
      }),
    );

    expect(result.status).toBe('joined');
    if (result.status !== 'joined') return; // type narrow
    expect(result.member.role).toBe('rider');
    expect(result.member.isActive).toBe(true);
    expect(result.member.email).toBe('first@example.com');
  });

  it('is idempotent — duplicate calls return the same membership without error', async () => {
    const clubId = await seedClub(testDb.db, 'idempotent');

    const first = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_dup',
        email: 'dup@example.com',
        displayName: 'Dup User',
      }),
    );
    const second = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_dup',
        email: 'dup@example.com',
        displayName: 'Dup User',
      }),
    );

    expect(first.status).toBe('joined');
    expect(second.status).toBe('joined');
    if (first.status !== 'joined' || second.status !== 'joined') return;
    expect(first.member.id).toBe(second.member.id);

    // Exactly one row in the table.
    const allRows = await testDb.db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.clerkUserId, 'user_dup')),
      );
    expect(allRows).toHaveLength(1);
  });

  it('reactivates a member who previously left voluntarily (is_active=false, no admin stamp)', async () => {
    const clubId = await seedClub(testDb.db, 'rejoin');

    // Seed an inactive (voluntarily-left) row — no admin stamp.
    await testDb.db.insert(clubMembers).values({
      clubId,
      clerkUserId: 'user_rejoin',
      email: 'rejoin@example.com',
      role: 'rider',
      isActive: false,
    });

    // Pre-join short-circuit: isUserMember filters on isActive=true so
    // a left member must report as not-a-member. Audit E-4.
    const isMemberBefore = await withTestDb(testDb.db, () =>
      isUserMember(clubId, 'user_rejoin'),
    );
    expect(isMemberBefore).toBe(false);

    // Re-join should reactivate the row, not throw on the unique index.
    const result = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_rejoin',
        email: 'rejoin-new@example.com', // updated email
        displayName: 'Rejoined User',
      }),
    );
    expect(result.status).toBe('joined');
    if (result.status !== 'joined') return;
    expect(result.member.isActive).toBe(true);
    // Display name + email re-synced from current Clerk profile.
    expect(result.member.email).toBe('rejoin-new@example.com');
    expect(result.member.displayName).toBe('Rejoined User');

    const isMemberAfter = await withTestDb(testDb.db, () =>
      isUserMember(clubId, 'user_rejoin'),
    );
    expect(isMemberAfter).toBe(true);

    // Still exactly one row — the existing one was reactivated, not duplicated.
    const allRows = await testDb.db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.clerkUserId, 'user_rejoin')),
      );
    expect(allRows).toHaveLength(1);
  });

  it('concurrent join attempts resolve to a single membership', async () => {
    const clubId = await seedClub(testDb.db, 'concurrent');

    const results = await withTestDb(testDb.db, () =>
      Promise.all([
        joinClubInstantly({
          clubId,
          clerkUserId: 'user_concurrent',
          email: 'c@example.com',
          displayName: 'C',
        }),
        joinClubInstantly({
          clubId,
          clerkUserId: 'user_concurrent',
          email: 'c@example.com',
          displayName: 'C',
        }),
        joinClubInstantly({
          clubId,
          clerkUserId: 'user_concurrent',
          email: 'c@example.com',
          displayName: 'C',
        }),
      ]),
    );

    // All three should return joined with the same row id.
    const ids = new Set(
      results.flatMap((r) => (r.status === 'joined' ? [r.member.id] : [])),
    );
    expect(ids.size).toBe(1);
    expect(results.every((r) => r.status === 'joined')).toBe(true);

    const allRows = await testDb.db
      .select()
      .from(clubMembers)
      .where(
        and(
          eq(clubMembers.clubId, clubId),
          eq(clubMembers.clerkUserId, 'user_concurrent'),
        ),
      );
    expect(allRows).toHaveLength(1);
  });

  it('does not cross tenants — joining Club A does not affect Club B membership', async () => {
    const clubA = await seedClub(testDb.db, 'tenant-a');
    const clubB = await seedClub(testDb.db, 'tenant-b');

    await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId: clubA,
        clerkUserId: 'user_cross',
        email: 'x@example.com',
        displayName: 'X',
      }),
    );

    // Same user joining Club B creates a separate membership row.
    await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId: clubB,
        clerkUserId: 'user_cross',
        email: 'x@example.com',
        displayName: 'X',
      }),
    );

    const allRows = await testDb.db
      .select()
      .from(clubMembers)
      .where(eq(clubMembers.clerkUserId, 'user_cross'));
    expect(allRows).toHaveLength(2);
    const clubIds = new Set(allRows.map((r) => r.clubId));
    expect(clubIds).toEqual(new Set([clubA, clubB]));
  });

  // Audit J-1: admin-kicked riders cannot trivially rejoin.
  it('refuses rejoin for an admin-deactivated member (deactivatedByAdminAt set)', async () => {
    const clubId = await seedClub(testDb.db, 'kicked');

    // Step 1: rider joins.
    const initialJoin = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_kicked',
        email: 'kick@example.com',
        displayName: 'Kicked User',
      }),
    );
    expect(initialJoin.status).toBe('joined');
    if (initialJoin.status !== 'joined') return;

    // Step 2: admin deactivates them via the staff DELETE handler path.
    await withTestDb(testDb.db, () =>
      deactivateMember(clubId, initialJoin.member.id),
    );

    // Step 3: rider tries to rejoin via the public open-club join.
    const rejoin = await withTestDb(testDb.db, () =>
      joinClubInstantly({
        clubId,
        clerkUserId: 'user_kicked',
        email: 'kick@example.com',
        displayName: 'Kicked User',
      }),
    );

    // Refused — the route layer maps this to a 403 with a "contact the
    // stable" message.
    expect(rejoin.status).toBe('kicked');

    // Underlying row stays inactive AND retains the admin stamp.
    const stored = await testDb.db
      .select()
      .from(clubMembers)
      .where(
        and(eq(clubMembers.clubId, clubId), eq(clubMembers.clerkUserId, 'user_kicked')),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.isActive).toBe(false);
    expect(stored[0]!.deactivatedByAdminAt).not.toBeNull();
  });
});
