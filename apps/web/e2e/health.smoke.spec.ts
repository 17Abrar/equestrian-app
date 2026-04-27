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
      console.error('deep probe degraded:', JSON.stringify(body, null, 2));
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

  test('rate limit on /api/v1/health kicks in after sustained traffic', async ({ request }) => {
    // 121 requests in a tight loop should trigger the 120/min cap.
    // Marked `slow()` so Playwright's default 30s timeout doesn't bite
    // on a cold-start prod isolate.
    test.slow();
    const results: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      const res = await request.get('/api/v1/health');
      results.push(res.status());
      if (res.status() === 429) break;
    }
    // We don't assert exactly when 429 fires — Cloudflare's edge can
    // route requests across multiple isolates so the per-isolate
    // counter takes a few extra hits to converge in dev. Just verify
    // we hit the cap eventually.
    const got429 = results.includes(429);
    expect(got429).toBe(true);
  });
});
