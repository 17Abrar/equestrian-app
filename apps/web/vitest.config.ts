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
    // Vitest picks up unit tests next to lib code. The `e2e/` folder is
    // Playwright's; running its specs through Vitest hits
    // `test.describe()` from `@playwright/test`, which throws
    // "Playwright Test did not expect test.describe() to be called
    // here." Exclude it explicitly.
    exclude: ['node_modules/**', 'dist/**', '.next/**', '.open-next/**', 'e2e/**'],
    env: {
      // Mirror the stubs in packages/db/vitest.config.ts so any
      // transitive module-load assertion (DATABASE_URL, ENCRYPTION_KEY)
      // is satisfied without making the tests actually connect. Other
      // env vars (NEXT_PUBLIC_APP_URL, Clerk keys, etc.) are typed as
      // literal strings via wrangler's generated cloudflare-env.d.ts
      // and so can't be overridden here — they aren't needed by the
      // current test set.
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      DATABASE_URL_UNPOOLED: 'postgres://test:test@localhost:5432/test',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
    },
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(fileURLToPath(new URL('.', import.meta.url))),
      // `server-only` is Next.js's "this file must run on the server"
      // guard; in the Vitest env we don't have a server runtime, so
      // alias it to a no-op shim so transitive imports (e.g.
      // `lib/tenant.ts` → `lib/clerk-helpers.ts`) don't fail at
      // module load.
      'server-only': path.resolve(
        fileURLToPath(new URL('./test-shims/server-only.ts', import.meta.url)),
      ),
    },
  },
});
