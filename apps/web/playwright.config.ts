import { defineConfig, devices } from '@playwright/test';

/**
 * Audit H-19. End-to-end coverage for the rider funnel — sign-up,
 * club join, book, pay. Today the suite is a skeleton with API-only
 * smoke tests against the deployed origin; the full sign-in flow
 * requires a long-lived test club + a Stripe test card setup that
 * lives outside this config (a follow-up `docs/e2e-setup.md` will
 * document the seed-script + the test-account credentials, which go
 * into repo secrets `E2E_TEST_USER_EMAIL` / `E2E_TEST_USER_PASSWORD`).
 *
 * Run modes:
 *   * `pnpm test:e2e`            — against PLAYWRIGHT_BASE_URL (defaults
 *                                  to http://localhost:3000)
 *   * `pnpm test:e2e:prod`       — against https://cavaliq.com (smoke
 *                                  only; never runs mutating tests on
 *                                  prod)
 *
 * The nightly CI workflow at `.github/workflows/e2e-nightly.yml` runs
 * `test:e2e:prod` on a cron schedule and pages on failure.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const IS_PROD_TARGET = BASE_URL.startsWith('https://cavaliq.com');

export default defineConfig({
  testDir: './e2e',
  // Each test gets 30s; prod smoke tests need slack for cold-start
  // worker isolates.
  timeout: 30_000,
  fullyParallel: true,
  // CI fails on `.only(...)` so a developer doesn't accidentally lock
  // the suite to a single test.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Only collect a screenshot on failure to keep CI artifact volume
    // bounded.
    screenshot: 'only-on-failure',
    // Don't masquerade as the test runner against prod — pass a
    // distinct UA so abuse heuristics can identify our traffic.
    userAgent: IS_PROD_TARGET ? 'cavaliq-e2e-nightly' : undefined,
  },

  projects: [
    // API-only smoke tests run via APIRequestContext — no browser bin
    // needed, fast, suitable for prod nightly.
    {
      name: 'api-smoke',
      testMatch: /.*\.smoke\.spec\.ts$/,
    },
    // Full browser tests run only locally / on dev origins. Excluded
    // from prod runs because they'd mutate prod state.
    ...(!IS_PROD_TARGET
      ? [
          {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            testIgnore: /.*\.smoke\.spec\.ts$/,
          },
        ]
      : []),
  ],
});
