import { describe, it, expect, vi, beforeEach } from 'vitest';

// `bootstrapClubAndMembership` is the synchronous-provisioning path
// behind /start-club. Tests here lock in:
//
//   - Slug conflict on an unrelated club → walks slug variants until
//     one commits. Without this, a brand-new admin signing up with a
//     name that collides with an existing slug would fail outright.
//   - Conflict on `clerk_org_id` (Svix redelivery or concurrent
//     bootstrap call beat us) → re-select the existing row instead of
//     looping through all 7 slug variants. Audit-shape: race-safe
//     convergence with the webhook handler.
//   - Slug-allocation exhaustion → fails fast with ClubBootstrapError
//     rather than silently returning undefined; the caller surfaces a
//     500 to the user.
//   - Member upsert returns the existing-or-newly-created row so the
//     caller can chain into a TenantContext-resolving redirect.

const { dbInsertMock, dbSelectMock, warnMock, errorMock } = vi.hoisted(() => ({
  dbInsertMock: vi.fn(),
  dbSelectMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock('@equestrian/db', () => ({
  db: { insert: dbInsertMock, select: dbSelectMock },
}));

vi.mock('@equestrian/db/schema', () => ({
  clubs: {
    id: 'clubs.id',
    slug: 'clubs.slug',
    clerkOrgId: 'clubs.clerkOrgId',
  },
  clubMembers: {
    id: 'clubMembers.id',
    clubId: 'clubMembers.clubId',
    clerkUserId: 'clubMembers.clerkUserId',
    deactivatedByAdminAt: 'clubMembers.deactivatedByAdminAt',
    isActive: 'clubMembers.isActive',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: warnMock, error: errorMock, info: vi.fn(), debug: vi.fn() },
}));

import { bootstrapClubAndMembership } from './club-bootstrap';

const CLERK_ORG_ID = 'org_test_abc';
const CLERK_USER_ID = 'user_test_xyz';
const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

const DEFAULTS = {
  clerkOrgId: CLERK_ORG_ID,
  clerkOrgName: 'JSR Equestrian Club',
  clerkOrgImageUrl: null,
  clerkUserId: CLERK_USER_ID,
  clerkRole: 'org:admin',
  displayName: 'Alice Admin',
  email: 'alice@example.com',
};

// Drizzle's insert chain: db.insert(table).values(...).onConflictDoNothing().returning() OR
// db.insert(table).values(...).onConflictDoUpdate({...}).returning(). The terminal
// `.returning()` is what resolves; intermediate methods return the chain.
function makeInsertChain(returningValue: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn(() => chain);
  chain.onConflictDoNothing = vi.fn(() => chain);
  chain.onConflictDoUpdate = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(returningValue));
  return chain;
}

// Drizzle's select chain: db.select(...).from(...).where(...).limit(...).
function makeSelectChain(limitValue: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(limitValue));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bootstrapClubAndMembership', () => {
  it('inserts both rows on the happy path — fresh org, no conflicts', async () => {
    // 1st insert: club. J-1 pre-check select: no existing member row.
    // 2nd insert: member upsert returning isActive=true.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID, isActive: true }]));
    dbSelectMock.mockReturnValueOnce(makeSelectChain([]));

    const result = await bootstrapClubAndMembership(DEFAULTS);

    expect(result).toEqual({
      clubId: CLUB_ID,
      memberId: MEMBER_ID,
      clubSlug: 'jsr-equestrian-club',
      clubAction: 'created',
      memberAction: 'created',
    });
    // J-1 pre-check is the only select in the happy path.
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next slug variant when the base slug is taken by an unrelated club', async () => {
    // First insert: empty returning (slug conflict). 1st select: no row for
    // THIS clerkOrgId → it's an unrelated club squatting the slug. Next
    // insert: success on the suffixed variant. 2nd select: J-1 pre-check
    // returns empty. Final insert: member upsert.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club-abcd' }]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID, isActive: true }]));
    dbSelectMock
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));

    const result = await bootstrapClubAndMembership(DEFAULTS);

    expect(result.clubSlug).toBe('jsr-equestrian-club-abcd');
    expect(result.clubAction).toBe('created');
    expect(dbSelectMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the existing club when clerk_org_id is already taken (webhook or duplicate bootstrap beat us)', async () => {
    // First insert: empty returning. 1st select: finds existing club for
    // this clerkOrgId. 2nd select: J-1 pre-check on the existing member
    // row returns empty (no admin-kick stamp). Final insert: member upsert.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID, isActive: true }]));
    dbSelectMock
      .mockReturnValueOnce(makeSelectChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]))
      .mockReturnValueOnce(makeSelectChain([]));

    const result = await bootstrapClubAndMembership(DEFAULTS);

    expect(result).toEqual({
      clubId: CLUB_ID,
      memberId: MEMBER_ID,
      clubSlug: 'jsr-equestrian-club',
      clubAction: 'existed',
      memberAction: 'created',
    });
    expect(dbInsertMock).toHaveBeenCalledTimes(2);
  });

  it('throws SLUG_EXHAUSTED when all 7 slug variants conflict on unrelated clubs', async () => {
    // 7 inserts (base + 6 suffixed), all returning empty. 7 selects, all
    // returning no row (i.e. an unrelated club holds each variant). Fails
    // before the member upsert, so the J-1 pre-check select is never made.
    for (let i = 0; i < 7; i++) {
      dbInsertMock.mockReturnValueOnce(makeInsertChain([]));
      dbSelectMock.mockReturnValueOnce(makeSelectChain([]));
    }

    await expect(bootstrapClubAndMembership(DEFAULTS)).rejects.toMatchObject({
      name: 'ClubBootstrapError',
      code: 'SLUG_EXHAUSTED',
    });
    expect(errorMock).toHaveBeenCalledWith(
      'club_bootstrap_slug_exhausted',
      expect.objectContaining({ clerkOrgId: CLERK_ORG_ID }),
    );
  });

  it('throws INSERT_FAILED when the member insert returning is empty (driver edge)', async () => {
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr' }]))
      .mockReturnValueOnce(makeInsertChain([]));
    dbSelectMock.mockReturnValueOnce(makeSelectChain([]));

    await expect(bootstrapClubAndMembership(DEFAULTS)).rejects.toMatchObject({
      name: 'ClubBootstrapError',
      code: 'INSERT_FAILED',
    });
  });

  it('does NOT throw NO_MEMBERSHIP-style errors — convergent semantics for the webhook race', async () => {
    // The whole point of this lib: when the webhook has already populated
    // BOTH rows, calling bootstrap again still resolves cleanly. The first
    // insert returns empty (clerk_org_id conflict), the J-1 pre-check
    // finds the existing row but no admin-kick stamp, and the second
    // insert takes the onConflictDoUpdate path and returns the existing
    // member id with isActive=true.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID, isActive: true }]));
    dbSelectMock
      .mockReturnValueOnce(makeSelectChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]))
      .mockReturnValueOnce(makeSelectChain([{ id: MEMBER_ID, deactivatedByAdminAt: null }]));

    const result = await bootstrapClubAndMembership(DEFAULTS);
    expect(result.clubId).toBe(CLUB_ID);
    expect(result.memberId).toBe(MEMBER_ID);
  });

  it('throws KICKED when the existing member row was deactivated by a club admin (Audit J-1 / pass-3 defense)', async () => {
    // Threat model: admin Alice deactivates admin Bob → Bob's row gets
    // `deactivated_by_admin_at = now()`, `is_active = false`.
    // `removeClerkOrgMembership` is fail-open, so on Clerk 5xx Bob retains
    // `orgId` in his JWT. He POSTs /api/v1/clubs/bootstrap before TTL
    // elapses. The J-1 pre-check must refuse — we MUST NOT unconditionally
    // flip is_active back to true on the upsert.
    dbInsertMock.mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr' }]));
    dbSelectMock.mockReturnValueOnce(
      makeSelectChain([
        { id: MEMBER_ID, deactivatedByAdminAt: new Date('2026-05-01T10:00:00Z') },
      ]),
    );

    await expect(bootstrapClubAndMembership(DEFAULTS)).rejects.toMatchObject({
      name: 'ClubBootstrapError',
      code: 'KICKED',
    });
    expect(warnMock).toHaveBeenCalledWith(
      'club_bootstrap_refused_kicked_member',
      expect.objectContaining({
        clerkOrgId: CLERK_ORG_ID,
        clerkUserId: CLERK_USER_ID,
        memberId: MEMBER_ID,
      }),
    );
    // The member upsert MUST NOT run — only the club insert.
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
  });

  it('throws KICKED on the TOCTOU race — concurrent admin DELETE lands between pre-check and upsert', async () => {
    // Pre-check returns clean (no stamp), but between the SELECT and the
    // INSERT a concurrent admin DELETE writes `deactivated_by_admin_at`.
    // The CASE expression in the SET clause re-evaluates the column at
    // upsert time and leaves is_active=false. We must detect that on the
    // returning row and refuse, not return an inactive member id to a
    // downstream caller that would then throw NO_MEMBERSHIP.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr' }]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID, isActive: false }]));
    dbSelectMock.mockReturnValueOnce(makeSelectChain([]));

    await expect(bootstrapClubAndMembership(DEFAULTS)).rejects.toMatchObject({
      name: 'ClubBootstrapError',
      code: 'KICKED',
    });
    expect(warnMock).toHaveBeenCalledWith(
      'club_bootstrap_race_with_admin_deactivation',
      expect.objectContaining({
        clerkOrgId: CLERK_ORG_ID,
        clerkUserId: CLERK_USER_ID,
        memberId: MEMBER_ID,
      }),
    );
  });
});
