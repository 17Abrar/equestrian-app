import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/v1/clubs/bootstrap is the synchronous-provisioning endpoint that
// replaces the legacy 30s poll on /start-club. Tests here lock in:
//
//   - Auth gating: bare auth() (NOT withAuth, which would itself throw
//     NO_MEMBERSHIP because the membership row doesn't exist yet).
//   - Rate limit: 10/min/user matches /clubs/[slug]/join — same kind of
//     membership-mutating endpoint.
//   - Clerk-API-as-source-of-truth: org name + caller role come from
//     the Backend SDK, not the request body. Defends against a session
//     probe trying to re-name an existing org.
//   - Caller-not-member-per-Clerk: if Clerk's API doesn't list the user
//     as a member of the org their JWT claims, refuse — indicates a
//     stale session from a removed user.
//   - Clerk API outage: 503 (transient, retry) rather than 500.
//   - Bootstrap library errors: surface SLUG_EXHAUSTED / INSERT_FAILED
//     as 500 with operator-visible logs.

const {
  authMock,
  clerkClientMock,
  currentUserMock,
  rateLimitMock,
  bootstrapMock,
  warnMock,
  errorMock,
  infoMock,
  getOrgMock,
  listMembershipsMock,
  FakeClubBootstrapError,
} = vi.hoisted(() => {
  // Declared at hoist time so `vi.mock` (also hoisted) can reference it
  // for the `ClubBootstrapError` export. Shape mirrors the real class
  // so `instanceof` checks in the route handler fire identically.
  class FakeClubBootstrapError extends Error {
    code: 'SLUG_EXHAUSTED' | 'INSERT_FAILED';
    constructor(code: 'SLUG_EXHAUSTED' | 'INSERT_FAILED', message: string) {
      super(message);
      this.code = code;
      this.name = 'ClubBootstrapError';
    }
  }
  return {
    authMock: vi.fn(),
    clerkClientMock: vi.fn(),
    currentUserMock: vi.fn(),
    rateLimitMock: vi.fn(),
    bootstrapMock: vi.fn(),
    warnMock: vi.fn(),
    errorMock: vi.fn(),
    infoMock: vi.fn(),
    getOrgMock: vi.fn(),
    listMembershipsMock: vi.fn(),
    FakeClubBootstrapError,
  };
});

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
  clerkClient: clerkClientMock,
  currentUser: currentUserMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: rateLimitMock,
}));

vi.mock('@/lib/club-bootstrap', () => ({
  bootstrapClubAndMembership: bootstrapMock,
  ClubBootstrapError: FakeClubBootstrapError,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: warnMock, error: errorMock, info: infoMock, debug: vi.fn() },
}));

vi.mock('@/lib/api-utils', () => ({
  successResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  errorResponse: (code: string, message: string, status: number, details?: unknown) =>
    new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}));

import { POST } from './route';

const USER_ID = 'user_test_abc';
const ORG_ID = 'org_test_xyz';
const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID });
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
  getOrgMock.mockResolvedValue({ name: 'JSR Equestrian Club', imageUrl: null });
  listMembershipsMock.mockResolvedValue({
    data: [{ publicUserData: { userId: USER_ID }, role: 'org:admin' }],
  });
  clerkClientMock.mockResolvedValue({
    organizations: {
      getOrganization: getOrgMock,
      getOrganizationMembershipList: listMembershipsMock,
    },
  });
  currentUserMock.mockResolvedValue({
    firstName: 'Alice',
    lastName: 'Admin',
    username: null,
    primaryEmailAddress: { emailAddress: 'alice@example.com' },
  });
  bootstrapMock.mockResolvedValue({
    clubId: CLUB_ID,
    memberId: MEMBER_ID,
    clubSlug: 'jsr-equestrian-club',
    clubAction: 'created',
    memberAction: 'created',
  });
});

describe('auth gating', () => {
  it('returns 401 when no Clerk session', async () => {
    authMock.mockResolvedValueOnce({ userId: null, orgId: null });

    const res = await POST();

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('returns 400 NO_ACTIVE_ORG when session has userId but no orgId', async () => {
    authMock.mockResolvedValueOnce({ userId: USER_ID, orgId: null });

    const res = await POST();

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NO_ACTIVE_ORG');
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});

describe('rate limit', () => {
  it('returns 429 with Retry-After when bootstrap rate-limit cap is hit', async () => {
    rateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 0,
      retryAfterMs: 5000,
    });

    const res = await POST();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(clerkClientMock).not.toHaveBeenCalled();
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});

describe('Clerk Backend API as source of truth', () => {
  it('returns 403 NOT_ORG_MEMBER when Clerk does not list the caller as a member of the org their JWT claims', async () => {
    listMembershipsMock.mockResolvedValueOnce({
      data: [{ publicUserData: { userId: 'someone_else' }, role: 'org:admin' }],
    });

    const res = await POST();

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_ORG_MEMBER');
    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      'bootstrap_caller_not_org_member',
      expect.objectContaining({ userId: USER_ID, clerkOrgId: ORG_ID }),
    );
  });

  it('returns 503 CLERK_API_UNAVAILABLE on Clerk API outage', async () => {
    getOrgMock.mockRejectedValueOnce(new Error('clerk 500'));

    const res = await POST();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CLERK_API_UNAVAILABLE');
    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith(
      'bootstrap_clerk_api_failed',
      expect.objectContaining({ userId: USER_ID, clerkOrgId: ORG_ID }),
    );
  });

  it('passes the Clerk org name + caller role into the bootstrap library — NOT request body data', async () => {
    getOrgMock.mockResolvedValueOnce({ name: 'Real Name From Clerk', imageUrl: 'https://logo' });
    listMembershipsMock.mockResolvedValueOnce({
      data: [{ publicUserData: { userId: USER_ID }, role: 'org:admin' }],
    });

    await POST();

    expect(bootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkOrgName: 'Real Name From Clerk',
        clerkOrgImageUrl: 'https://logo',
        clerkRole: 'org:admin',
        clerkUserId: USER_ID,
        clerkOrgId: ORG_ID,
      }),
    );
  });
});

describe('successful bootstrap', () => {
  it('returns 201 with the bootstrap result envelope', async () => {
    const res = await POST();

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { clubId: string; memberId: string; slug: string };
    };
    expect(body).toEqual({
      success: true,
      data: { clubId: CLUB_ID, memberId: MEMBER_ID, slug: 'jsr-equestrian-club' },
    });
    expect(infoMock).toHaveBeenCalledWith(
      'club_bootstrapped',
      expect.objectContaining({ clubId: CLUB_ID, memberId: MEMBER_ID }),
    );
  });

  it('coalesces firstName + lastName into displayName, falling back through username to null', async () => {
    currentUserMock.mockResolvedValueOnce({
      firstName: null,
      lastName: null,
      username: 'aliceadmin',
      primaryEmailAddress: { emailAddress: 'alice@example.com' },
    });

    await POST();

    expect(bootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'aliceadmin' }),
    );
  });
});

describe('bootstrap library error handling', () => {
  it('returns 500 with the ClubBootstrapError code when the lib throws SLUG_EXHAUSTED', async () => {
    bootstrapMock.mockRejectedValueOnce(
      new FakeClubBootstrapError('SLUG_EXHAUSTED', 'no slugs left'),
    );

    const res = await POST();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SLUG_EXHAUSTED');
    expect(errorMock).toHaveBeenCalledWith(
      'bootstrap_failed',
      expect.objectContaining({ code: 'SLUG_EXHAUSTED' }),
    );
  });

  it('returns 500 INTERNAL_ERROR when the lib throws an unknown error', async () => {
    bootstrapMock.mockRejectedValueOnce(new Error('unexpected'));

    const res = await POST();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(errorMock).toHaveBeenCalledWith(
      'bootstrap_unhandled_error',
      expect.objectContaining({ error: 'unexpected' }),
    );
  });
});
