import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Stub the env vars that production code asserts at module load time.
    // Tests swap `db` for a pglite-backed drizzle via `withTestDb`, so the
    // httpDb client never actually connects — but the `new Error(...)`
    // check at the top of `src/index.ts` still fires on import unless
    // DATABASE_URL is set to something.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      DATABASE_URL_UNPOOLED: 'postgres://test:test@localhost:5432/test',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
    },
    // One WASM Postgres per test file keeps memory predictable; pglite
    // instances are ~20MB each and accumulate across tests otherwise.
    pool: 'forks',
  },
});
