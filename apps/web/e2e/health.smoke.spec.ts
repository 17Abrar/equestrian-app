import { test, expect } from '@playwright/test';

/**
 * Audit H-19 — minimal API-only smoke tests that exercise public
 * endpoints against any environment. Runs nightly against prod via
 * `.github/workflows/e2e-nightly.yml`.
 *
 * Add new smoke tests to *.smoke.spec.ts; full-browser tests live in
 * non-smoke files and only run locally.
 */

test.describe('public endpoints', () => {
  test('liveness probe returns 200 with status:ok', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('deep readiness probe surfaces all subsystems', async ({ request }) => {
    const res = await request.get('/api/v1/health?deep=1');
    // 200 when everything's green, 503 when at least one subsystem is
    // down. Either is a valid response shape — we just check the
    // contract.
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body.data.subsystems).toBeDefined();
    expect(body.data.subsystems.database).toBeDefined();
    expect(body.data.subsystems.redis).toBeDefined();
    // If status is 503, fail loudly so the cron alerts.
    if (res.status() === 503) {
      await test.info().attach('deep-probe-degraded.json', {
        body: JSON.stringify(body, null, 2),
        contentType: 'application/json',
      });
      throw new Error(`Deep health probe returned 503 — subsystem(s) down`);
    }
  });

  test('discover/clubs is reachable + returns a paginated envelope', async ({ request }) => {
    const res = await request.get('/api/v1/discover/clubs');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(typeof body.pagination.total).toBe('number');
  });

  // Rate-limit assertion moved to a unit test (audit H-6). Hitting
  // /api/v1/health 130× nightly polluted the prod rate-limit counter
  // for the GitHub Actions egress IP — other CI jobs from the same NAT
  // pool then saw 429s for ~60s afterward. The unit test against
  // `lib/rate-limit.ts` with a mocked Upstash gives the same coverage
  // without the side effect.
});
