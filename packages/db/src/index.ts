import { AsyncLocalStorage } from 'node:async_hooks';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';

import * as schema from './schema/index';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Only polyfill WebSocket for Node < 22 where it's not global. On Cloudflare
// Workers the native `globalThis.WebSocket` is used by `@neondatabase/
// serverless`; `require('ws')` must not be evaluated there (it pulls in
// node:net/tls which the Workers bundler cannot satisfy).
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

// ─── HTTP driver (the default path) ───────────────────────────────────
//
// One-shot HTTP queries. Stateless, no TCP handshake per request, no
// transaction support but fast enough that most routes can just use this.
//
// Used for: every tenant-scoped read, every single-statement write, every
// cross-tenant lookup (clubs, club_members, audit_log). When you call
// `db.select().from(...).where(eq(table.clubId, X))` you get HTTP speed.

const sqlClient = neon(process.env.DATABASE_URL);
const httpDb = drizzleHttp(sqlClient, { schema });

type SchemaType = typeof schema;
type HttpDb = NeonHttpDatabase<SchemaType>;
type WsDb = NeonDatabase<SchemaType>;
type WsTx = Parameters<Parameters<WsDb['transaction']>[0]>[0];
type AnyExecutor = HttpDb | WsDb | WsTx;

/**
 * `db` is the HTTP-driver executor. Single-statement queries over Neon's
 * HTTP endpoint — no WebSocket handshake per request. Tenant isolation is
 * enforced purely at the application level via explicit
 * `.where(eq(table.clubId, X))` clauses on every query.
 *
 * Do NOT call `.transaction()` on this — HTTP mode supports only the
 * non-interactive array-transaction form. If you need an interactive
 * multi-statement transaction (capacity checks, row locks, counter
 * increments), use `writeTransaction(fn)` which opens a WebSocket pool.
 *
 * We still expose `db` as a Proxy so any in-flight transaction's
 * executor (pushed via `executorStore.run`) takes over automatically —
 * callers inside a `writeTransaction(fn)` callback that use plain `db`
 * still participate in the surrounding transaction.
 */
const executorStore = new AsyncLocalStorage<AnyExecutor>();

export function getCurrentExecutor(): AnyExecutor {
  return executorStore.getStore() ?? httpDb;
}

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
 * Runs `fn` inside a Postgres transaction opened over a fresh WebSocket
 * Pool. Use this only for true multi-statement atomic writes:
 *   - capacity checks + inserts (e.g., booking creation against slot)
 *   - row-level locks (`.for('update')`)
 *   - counter increments that must observe the parent write
 *
 * Inside the callback, every `db.*` call routes to the transaction via
 * the AsyncLocalStorage executor, so existing code that uses `db`
 * automatically joins the transaction.
 *
 * Each call pays a ~100–200ms WebSocket handshake cost. That's why we
 * keep this path narrow — most routes don't need it and use `db` over
 * HTTP instead.
 */
export async function writeTransaction<T>(
  fn: (tx: WsTx) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const wsDb = drizzleWs(pool, { schema });
  try {
    return await wsDb.transaction(async (tx) => {
      return executorStore.run(tx, () => fn(tx));
    });
  } finally {
    await pool.end();
  }
}

/**
 * Direct access to the HTTP driver — use for operations that must bypass
 * any ambient transaction (webhooks, Clerk org resolution, audit writes
 * that survive a tenant transaction rollback).
 *
 * Exposed as a Proxy only so the test harness can override it; in
 * production `rawExecutorStore` is always empty and calls land on
 * `httpDb` directly.
 */
const rawExecutorStore = new AsyncLocalStorage<AnyExecutor>();

export const rawDb = new Proxy({} as HttpDb, {
  get(_target, prop) {
    const executor = (rawExecutorStore.getStore() ?? httpDb) as unknown as Record<
      string | symbol,
      unknown
    >;
    const value = executor[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(executor);
    }
    return value;
  },
});

export type Database = HttpDb;
export type PoolDatabase = WsDb;

/**
 * Test-only escape hatch: run `fn` with an arbitrary drizzle executor
 * bound to BOTH ambient stores (the main `db` Proxy and `rawDb`), so
 * every query in the graph — including the ones that deliberately
 * bypass ambient transactions via `rawDb` — routes to the test db.
 * Production code must not call this.
 *
 * Accepts `unknown` so tests can push a pglite-backed drizzle instance
 * without widening the production `AnyExecutor` union. The Proxy only
 * dispatches by method name at runtime, so any drizzle-like object
 * with the same surface works.
 */
export function __runWithExecutorForTest<T>(
  executor: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return executorStore.run(executor as AnyExecutor, () =>
    rawExecutorStore.run(executor as AnyExecutor, fn),
  );
}
