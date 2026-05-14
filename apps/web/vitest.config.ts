import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Audit 2026-05-13 (P1): introduce Vitest in apps/web so unit tests can
// live next to the lib code they cover (e.g. lib/payments/*.test.ts,
// lib/api-utils.test.ts). Previously apps/web only had Playwright E2E;
// pure functions in lib/ had no test harness.
//
// We intentionally do NOT run these tests against Next.js's bundler —
// the targets are framework-agnostic helpers that import only Node /
// browser primitives. The `@/` path alias mirrors tsconfig.json so
// imports like `@/lib/logger` resolve from `apps/web/`.
export default defineConfig({
  test: {
    env: {
      // Mirror the stubs in packages/db/vitest.config.ts so any
      // transitive module-load assertion (DATABASE_URL, ENCRYPTION_KEY)
      // is satisfied without making the tests actually connect.
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      DATABASE_URL_UNPOOLED: 'postgres://test:test@localhost:5432/test',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      // Mute the optional Sentry path under test.
      NEXT_PUBLIC_APP_URL: 'https://test.cavaliq.local',
    },
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('.', import.meta.url))),
    },
  },
});
