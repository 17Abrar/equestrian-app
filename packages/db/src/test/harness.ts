import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as schema from '../schema/index';
import { __runWithExecutorForTest } from '../index';

/**
 * Applies every migration in `packages/db/migrations/` to a pglite
 * instance using its multi-statement `exec()` API. We avoid
 * `drizzle-orm/pglite/migrator` because (a) it uses prepared
 * statements, which requires `--> statement-breakpoint` markers that
 * the hand-written migrations 0006–0014 don't have, and (b) it reads
 * `meta/_journal.json`, which only lists drizzle-kit-generated
 * migrations — the hand-written ones (which prod applied
 * out-of-band) are absent from the journal.
 *
 * Instead, we glob every `.sql` under `migrations/`, sort by filename
 * (the `NNNN_*` prefix makes lexical order == apply order), and exec
 * each as a single statement. All our migrations are idempotent
 * (`IF NOT EXISTS` / `IF EXISTS` guards) so running them on a fresh
 * pglite instance is safe.
 */
async function applyMigrations(client: PGlite): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '..', '..', 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await client.exec(sql);
  }
}

/**
 * Boots a fresh in-process Postgres (pglite / WASM), applies every
 * migration, and returns a drizzle instance bound to it. Each call
 * creates a *new* database so tests are fully isolated — tenant-
 * isolation tests in particular depend on the DB starting empty.
 */
export async function createTestDb() {
  const client = new PGlite();
  await applyMigrations(client);
  const db = drizzle(client, { schema });

  return {
    db,
    client,
    /** Close the underlying pglite connection. Tests should call this
     *  in `afterEach` to release WASM memory. */
    async close() {
      await client.close();
    },
  };
}

/**
 * Runs `fn` with the production `db` Proxy rebound to the given test
 * executor. Inside, every query function imported from `../queries`
 * routes through the test db — the Proxy in `index.ts` dispatches by
 * the ambient AsyncLocalStorage executor.
 */
export function withTestDb<T>(
  testDb: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return __runWithExecutorForTest(testDb, fn);
}
