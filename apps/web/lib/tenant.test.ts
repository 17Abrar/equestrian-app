import { describe, it, expect, vi, beforeEach } from 'vitest';

// `tenant.ts` is the SOLE multi-tenant scoping helper for apps/web
// (the database has no RLS — see CLAUDE.md). Tests here lock in the
// authorization-bypass and silent-state-rewrite fixes from the audit
// trail so a future refactor can't quietly reopen them:
//
//   - Path 1 NO_MEMBERSHIP (audit pass-3, 2026-05-09): never trust
//     Clerk-derived role when no active `club_members` row exists.
//     Closes a deactivation-bypass window where a kicked admin's JWT
//     still carried 'org:admin' until TTL.
//   - Path 2 stale cookie clear (audit F-32, 2026-05-07 r4): a cookie
//     pointing at a no-longer-active membership must clear, not silently
//     rewrite to the fallback club — otherwise a kicked rider's session
//     hops to a different club without consent.

// `vi.mock` is hoisted above all imports, so the factories can't close
// over module-scope `const`s — we declare the mock fns via `vi.hoisted`
// to make them available at hoist time.
const { authMock, cookieGetMock, cookieSetMock, limitMock, orderByMock, warnMock, debugMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    cookieGetMock: vi.fn(),
    cookieSetMock: vi.fn(),
    limitMock: vi.fn(),
    orderByMock: vi.fn(),
    warnMock: vi.fn(),
    debugMock: vi.fn(),
  }));

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGetMock, set: cookieSetMock }),
}));

// Drizzle's query builder is fluent — every intermediate method
// (`.from`, `.where`, `.innerJoin`) returns the same chain object, and
// only the terminal methods (`.limit`, `.orderBy`) resolve to data.
// We mock the chain once and queue per-test results on the terminals.
vi.mock('@equestrian/db', () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.limit = limitMock;
  chain.orderBy = orderByMock;
  return { db: { select: vi.fn(() => chain) } };
});

// Schema imports resolve to opaque sentinels — `tenant.ts` only uses
// them inside Drizzle expression builders (`eq`, `and`, …), which the
// chain mock ignores. We just need non-undefined values so the imports
// don't throw.
vi.mock('@equestrian/db/schema', () => ({
  clubs: { id: 'clubs.id', clerkOrgId: 'clubs.clerkOrgId' },
  clubMembers: { id: 'clubMembers.id', clerkUserId: 'clubMembers.clerkUserId' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: warnMock, debug: debugMock, error: vi.fn(), info: vi.fn() },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: vi.fn() }),
}));

import {
  getTenantContext,
  withTenantContext,
  TenantError,
  ACTIVE_CLUB_COOKIE,
} from './tenant';

const CLUB_A = 'club-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLUB_B = 'club-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MEMBER_A = 'memb-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_B = 'memb-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID = 'user_2abc';
const ORG_ID = 'org_2xyz';
const CLERK_ORG_ID = 'org_clerk_clubA';

beforeEach(() => {
  vi.clearAllMocks();
  cookieGetMock.mockReturnValue(undefined);
});

describe('getTenantContext — unauthenticated', () => {
  it('throws UNAUTHORIZED when Clerk returns no userId', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });

    await expect(getTenantContext()).rejects.toMatchObject({
      name: 'TenantError',
      code: 'UNAUTHORIZED',
    });
  });
});

describe('getTenantContext — Path 1 (Clerk active org)', () => {
  it('returns the member-role context when org + active membership both resolve', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID });
    // club lookup
    limitMock.mockResolvedValueOnce([{ id: CLUB_A, onboardingCompletedAt: new Date() }]);
    // member lookup
    limitMock.mockResolvedValueOnce([{ id: MEMBER_A, role: 'club_admin' }]);

    const ctx = await getTenantContext();

    expect(ctx).toEqual({
      clubId: CLUB_A,
      memberId: MEMBER_A,
      userId: USER_ID,
      orgId: ORG_ID,
      orgRole: 'club_admin',
      onboardingCompleted: true,
    });
  });

  it('reports onboardingCompleted=false when the club has no onboardingCompletedAt', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID });
    limitMock.mockResolvedValueOnce([{ id: CLUB_A, onboardingCompletedAt: null }]);
    limitMock.mockResolvedValueOnce([{ id: MEMBER_A, role: 'club_admin' }]);

    const ctx = await getTenantContext();

    expect(ctx.onboardingCompleted).toBe(false);
  });

  it('throws NO_MEMBERSHIP — never falls back to Clerk JWT role — when club resolves but no active member row exists', async () => {
    // Locks in audit pass-3 (2026-05-09). Previously the code fell open
    // to `'rider'` (audit auth-5) or to `orgRole` from the Clerk JWT;
    // both let a just-deactivated admin keep admin powers until JWT TTL.
    authMock.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID });
    limitMock.mockResolvedValueOnce([{ id: CLUB_A, onboardingCompletedAt: new Date() }]);
    limitMock.mockResolvedValueOnce([]); // no active membership

    await expect(getTenantContext()).rejects.toMatchObject({
      name: 'TenantError',
      code: 'NO_MEMBERSHIP',
    });
  });

  it('falls through to Path 2 when orgId is set but no club is paired with it', async () => {
    // Real scenario: rider's session sits on a legacy Clerk org with no
    // paired club, but they joined a stable via /discover. Must not 500.
    authMock.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID });
    limitMock.mockResolvedValueOnce([]); // no club for this orgId
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.clubId).toBe(CLUB_A);
    expect(ctx.orgRole).toBe('rider');
    expect(warnMock).toHaveBeenCalledWith(
      'tenant_org_no_club_falling_through',
      expect.objectContaining({ userId: USER_ID, orgId: ORG_ID }),
    );
  });
});

describe('getTenantContext — Path 2 (club_members fallback)', () => {
  it('throws NO_ORGANIZATION when the user has zero active memberships', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    orderByMock.mockResolvedValueOnce([]);

    await expect(getTenantContext()).rejects.toMatchObject({
      name: 'TenantError',
      code: 'NO_ORGANIZATION',
    });
  });

  it('uses the most-recently-joined membership when no active-club cookie is set', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
      {
        memberId: MEMBER_B,
        clubId: CLUB_B,
        role: 'parent',
        clubName: 'Stable B',
        clubSlug: 'stable-b',
        clerkOrgId: null,
        onboardingCompletedAt: null,
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.clubId).toBe(CLUB_A);
    expect(ctx.orgRole).toBe('rider');
    expect(ctx.memberships).toHaveLength(2);
  });

  it('honors the active-club cookie when it names a current membership', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    cookieGetMock.mockReturnValue({ value: CLUB_B });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
      {
        memberId: MEMBER_B,
        clubId: CLUB_B,
        role: 'parent',
        clubName: 'Stable B',
        clubSlug: 'stable-b',
        clerkOrgId: null,
        onboardingCompletedAt: null,
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.clubId).toBe(CLUB_B);
    expect(ctx.orgRole).toBe('parent');
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it('clears a stale active-club cookie instead of silently rewriting it to the fallback club', async () => {
    // Locks in audit F-32 (2026-05-07 r4). The old shape rewrote the
    // cookie to memberships[0] when the chosen membership had vanished
    // — silently moving a kicked-out rider's session into a different
    // club. The fix is to clear the cookie (maxAge: 0) so the next
    // explicit user action writes a fresh one.
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    cookieGetMock.mockReturnValue({ value: 'club-stale-no-longer-a-member' });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.clubId).toBe(CLUB_A); // fell back to most-recent
    expect(cookieSetMock).toHaveBeenCalledWith(
      ACTIVE_CLUB_COOKIE,
      '',
      expect.objectContaining({ maxAge: 0, httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('does not blow up if the cookie-clear write throws (RSC read-only context)', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    cookieGetMock.mockReturnValue({ value: 'club-stale' });
    cookieSetMock.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.clubId).toBe(CLUB_A);
    expect(debugMock).toHaveBeenCalledWith(
      'active_club_cookie_clear_skipped',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it('falls orgId back to clubId when the resolved club has no clerkOrgId', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: null,
        onboardingCompletedAt: new Date(),
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.orgId).toBe(CLUB_A);
  });

  it('exposes all memberships on the context so callers avoid a second round-trip', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
      {
        memberId: MEMBER_B,
        clubId: CLUB_B,
        role: 'parent',
        clubName: 'Stable B',
        clubSlug: 'stable-b',
        clerkOrgId: null,
        onboardingCompletedAt: null,
      },
    ]);

    const ctx = await getTenantContext();

    expect(ctx.memberships).toEqual([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        role: 'rider',
      },
      {
        memberId: MEMBER_B,
        clubId: CLUB_B,
        clubName: 'Stable B',
        clubSlug: 'stable-b',
        role: 'parent',
      },
    ]);
  });
});

describe('withTenantContext', () => {
  it('passes the resolved context to the callback and returns its result', async () => {
    authMock.mockResolvedValue({ userId: USER_ID, orgId: null });
    orderByMock.mockResolvedValueOnce([
      {
        memberId: MEMBER_A,
        clubId: CLUB_A,
        role: 'rider',
        clubName: 'Stable A',
        clubSlug: 'stable-a',
        clerkOrgId: CLERK_ORG_ID,
        onboardingCompletedAt: new Date(),
      },
    ]);

    const result = await withTenantContext(async (ctx) => ({ seen: ctx.clubId }));

    expect(result).toEqual({ seen: CLUB_A });
  });

  it('propagates TenantError thrown by the resolver — does not swallow it', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });

    const cb = vi.fn();
    await expect(withTenantContext(cb)).rejects.toBeInstanceOf(TenantError);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('TenantError', () => {
  it('exposes code, message, and name=TenantError', () => {
    const err = new TenantError('NO_MEMBERSHIP', 'gone');

    expect(err.code).toBe('NO_MEMBERSHIP');
    expect(err.message).toBe('gone');
    expect(err.name).toBe('TenantError');
    expect(err).toBeInstanceOf(Error);
  });
});
