#!/usr/bin/env node
/**
 * Applies every migration in `packages/db/migrations/` to a Neon
 * database via the WebSocket Pool (multi-statement-safe).
 *
 * Why not `pnpm db:migrate` (drizzle-kit)?
 *   drizzle-kit splits migration files on `--> statement-breakpoint`
 *   markers and runs each chunk as a single prepared statement.
 *   Migrations 0006–0015 in this repo are hand-written without those
 *   markers (drizzle-kit only auto-generates them when *it* generates
 *   the migration). On Neon's HTTP driver — and on any
 *   prepared-statement protocol — that means a file with multiple
 *   `;`-separated statements fails with "cannot insert multiple
 *   commands into a prepared statement".
 *
 *   Neon's Pool driver opens a real Postgres connection over
 *   WebSocket and accepts multi-statement queries via
 *   `client.query()`. We use that here so the existing migration
 *   format keeps working without retrofitting markers across 10
 *   files.
 *
 * Reads files from `packages/db/migrations/*.sql`, sorted by
 * filename (the `NNNN_*` prefix gives lexical order = apply order).
 * Idempotent on every axis: each migration is wrapped in
 * `IF NOT EXISTS` / `IF EXISTS` guards already.
 *
 * Run:
 *   DATABASE_URL_UNPOOLED=postgres://... node scripts/migrate-neon.mjs
 *
 * The "unpooled" URL is required — pgbouncer (which Neon's pooled
 * URL goes through) rejects DDL.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Polyfill WebSocket for Node — Neon's serverless driver expects it
// on `globalThis` (modern Node 22+) or via this config hook (older).
if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('error: DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL must be set.');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'packages', 'db', 'migrations');

async function run() {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`error: no migrations found in ${migrationsDir}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log(`applying ${files.length} migration(s) to ${redactUrl(DATABASE_URL)}`);
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query(sql);
        console.log(`  ok  ${file}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  fail ${file}: ${message}`);
        throw err;
      }
    }
    console.log('done');
  } finally {
    client.release();
    await pool.end();
  }
}

function redactUrl(url) {
  // Hide the password segment of the connection string when logging.
  return url.replace(/(\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
