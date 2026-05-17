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
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID }]));

    const result = await bootstrapClubAndMembership(DEFAULTS);

    expect(result).toEqual({
      clubId: CLUB_ID,
      memberId: MEMBER_ID,
      clubSlug: 'jsr-equestrian-club',
      clubAction: 'created',
      memberAction: 'created',
    });
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it('falls back to the next slug variant when the base slug is taken by an unrelated club', async () => {
    // First insert: empty returning (slug conflict). Select: no row for THIS
    // clerkOrgId → it's an unrelated club squatting the slug. Next insert:
    // success on the suffixed variant.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club-abcd' }]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID }]));
    dbSelectMock.mockReturnValueOnce(makeSelectChain([]));

    const result = await bootstrapClubAndMembership(DEFAULTS);

    expect(result.clubSlug).toBe('jsr-equestrian-club-abcd');
    expect(result.clubAction).toBe('created');
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the existing club when clerk_org_id is already taken (webhook or duplicate bootstrap beat us)', async () => {
    // First insert: empty returning. Select: finds existing club for this
    // clerkOrgId → use it without trying any more slug variants.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID }]));
    dbSelectMock.mockReturnValueOnce(
      makeSelectChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]),
    );

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
    // returning no row (i.e. an unrelated club holds each variant).
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

    await expect(bootstrapClubAndMembership(DEFAULTS)).rejects.toMatchObject({
      name: 'ClubBootstrapError',
      code: 'INSERT_FAILED',
    });
  });

  it('does NOT throw NO_MEMBERSHIP-style errors — convergent semantics for the webhook race', async () => {
    // The whole point of this lib: when the webhook has already populated
    // BOTH rows, calling bootstrap again still resolves cleanly. The first
    // insert returns empty (clerk_org_id conflict), the second insert
    // takes the onConflictDoUpdate path and returns the existing member id.
    dbInsertMock
      .mockReturnValueOnce(makeInsertChain([]))
      .mockReturnValueOnce(makeInsertChain([{ id: MEMBER_ID }]));
    dbSelectMock.mockReturnValueOnce(
      makeSelectChain([{ id: CLUB_ID, slug: 'jsr-equestrian-club' }]),
    );

    const result = await bootstrapClubAndMembership(DEFAULTS);
    expect(result.clubId).toBe(CLUB_ID);
    expect(result.memberId).toBe(MEMBER_ID);
  });
});
