import { AsyncLocalStorage } from 'node:async_hooks';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';

import * as schema from './schema/index';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Polyfill the WebSocket constructor only on Node < 22 in environments where it
// is missing. On Cloudflare Workers `globalThis.WebSocket` is native and works
// for outbound connections; setting `neonConfig.webSocketConstructor` is not
// needed and `require('ws')` must not be evaluated (it pulls in node:net/tls
// which the Workers bundler cannot satisfy).
if (
  typeof globalThis.WebSocket === 'undefined' &&
  typeof process !== 'undefined' &&
  process.versions?.node
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wsModule = require('ws') as { default?: typeof WebSocket } | typeof WebSocket;
  const ctor =
    (wsModule as { default?: typeof WebSocket }).default ?? (wsModule as typeof WebSocket);
  neonConfig.webSocketConstructor = ctor;
}

// HTTP driver — fast single-statement queries, no transaction support. Used as
// the fallback outside a tenant context (webhooks, tenant resolution lookups,
// migrations). Safe to instantiate at module scope because the underlying
// `neon()` client is stateless and uses one-shot HTTP requests.
const sqlClient = neon(process.env.DATABASE_URL);
const rawDb = drizzleHttp(sqlClient, { schema });

type SchemaType = typeof schema;
type HttpDb = NeonHttpDatabase<SchemaType>;
type WsDb = NeonDatabase<SchemaType>;
type WsTx = Parameters<Parameters<WsDb['transaction']>[0]>[0];

// The runtime executor can be any of these, but TypeScript sees a single type
// via the Proxy so method signatures resolve cleanly at call sites. The
// Drizzle query-builder surface (select/insert/update/delete/execute/transaction)
// is identical across HttpDb / WsDb / WsTx, so typing as HttpDb is accurate
// enough for every existing caller.
type AnyExecutor = HttpDb | WsDb | WsTx;

// AsyncLocalStorage propagates the active executor through every `await` chain
// so queries automatically participate in the tenant-scoped transaction that
// set `app.current_club_id`. Without this, a second call to `db.select()` after
// an `await` would get a fresh HTTP connection with no session variable, and
// RLS would silently drop every row.
const executorStore = new AsyncLocalStorage<AnyExecutor>();

export function getCurrentExecutor(): AnyExecutor {
  return executorStore.getStore() ?? rawDb;
}

/**
 * Runs `fn` inside a pooled transaction that has `app.current_club_id` set
 * for the given club. All queries issued via the exported `db` Proxy inside
 * the callback are RLS-filtered to that club.
 *
 * On Cloudflare Workers a WebSocket cannot outlive a single request, so we
 * open a fresh Pool per call and tear it down in `finally`. This costs one
 * TCP+TLS handshake (~50-150ms to Neon) per tenant-scoped request. With
 * `placement: smart` the Worker is co-located near Neon after the first few
 * invocations, minimizing the overhead. Keeping the Pool at module scope (the
 * previous pattern) works on Node but fails on the second request on Workers
 * because the isolate reuses the frozen socket.
 *
 * `set_config(..., is_local=true)` scopes the variable to the current
 * transaction, so it is released when the transaction commits/rolls back and
 * cannot leak between requests even if a connection is somehow reused.
 *
 * See: https://neon.com/docs/guides/cloudflare-workers — Pool lifecycle rules.
 */
export async function runInTenantContext<T>(
  clubId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenantDb = drizzleWs(pool, { schema });
  try {
    return await tenantDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_club_id', ${clubId}, true)`);
      return executorStore.run(tx, fn);
    });
  } finally {
    // Must await — backgrounding with queueMicrotask may run after the isolate
    // freezes, leaking the socket on Cloudflare's runtime.
    await pool.end();
  }
}

/**
 * Proxy that forwards every property access to the active executor.
 * Existing call sites that do `db.select()`, `db.insert()`, `db.transaction()`,
 * etc., keep working; they now transparently use the tenant-scoped transaction
 * when one is active, and fall back to the HTTP driver outside that scope.
 *
 * Drizzle query builders bind to the executor they're created from, so the
 * chained `.from().where()` calls all run on the right connection.
 */
export const db = new Proxy({} as HttpDb, {
  get(_target, prop) {
    const executor = getCurrentExecutor() as unknown as Record<string | symbol, unknown>;
    const value = executor[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(executor);
    }
    return value;
  },
});

/**
 * Escape hatch for code that must bypass tenant context — webhook handlers,
 * Clerk org resolution, admin maintenance. Use sparingly and only on tables
 * that are intentionally exempt from RLS (clubs, club_members, audit_log,
 * community_*).
 */
export { rawDb };

export type Database = HttpDb;
export type PoolDatabase = WsDb;
