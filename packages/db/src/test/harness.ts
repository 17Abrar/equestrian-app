import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as schema from '../schema/index';
import { __runWithExecutorForTest } from '../index';

interface JournalEntry {
  idx: number;
  tag: string;
}
interface Journal {
  entries: JournalEntry[];
}

/**
 * Applies every migration listed in `migrations/meta/_journal.json` to
 * a pglite instance using its multi-statement `exec()` API. We avoid
 * `drizzle-orm/pglite/migrator` because it uses prepared statements,
 * which requires `--> statement-breakpoint` markers that hand-written
 * migrations 0006+ don't have.
 *
 * The harness was previously globbing `*.sql` and sorting by filename.
 * That is the same lexical-order shape the prod runner uses on disk,
 * BUT it silently masked an entire bug class: a SQL file landing on
 * disk WITHOUT a corresponding `meta/_journal.json` entry would still
 * apply in tests (and the test would pass) while `drizzle-kit migrate`
 * — which reads the journal — would skip the file in prod. PR #84
 * shipped exactly that bug (audit 2026-05-08 r6 PR Nu-2 collided
 * `0048_…webhook_secret_hash_uniqueness.sql` with `0048_…horse_care_
 * phi_encryption.sql`; the orphan was renamed to `0051_…` post-merge).
 *
 * Reading the journal here flips that failure mode: an orphan file
 * fails fast in CI rather than masquerading as green.
 */
async function applyMigrations(client: PGlite): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '..', '..', 'migrations');

  const journalRaw = await readFile(
    path.join(migrationsDir, 'meta', '_journal.json'),
    'utf8',
  );
  const journal = JSON.parse(journalRaw) as Journal;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  // Cross-check: every `.sql` on disk must be accounted for in the
  // journal. An orphan (file present, journal entry missing) means the
  // contributor forgot to register the migration — surface immediately.
  const sqlFiles = new Set(
    (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, '')),
  );
  const journaled = new Set(ordered.map((e) => e.tag));
  const orphans = [...sqlFiles].filter((t) => !journaled.has(t));
  if (orphans.length > 0) {
    throw new Error(
      `Migration files present on disk but missing from meta/_journal.json: ${orphans.join(
        ', ',
      )}. Append a journal entry — see packages/db/README.md.`,
    );
  }

  for (const entry of ordered) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    const sql = await readFile(sqlPath, 'utf8');
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
