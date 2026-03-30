import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import * as schema from './schema/index';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Enable WebSocket support for Node.js environments (Vercel serverless functions).
// Not needed in edge runtime or browsers where WebSocket is native.
neonConfig.webSocketConstructor = ws;

// HTTP driver — fast single-statement queries, no transaction support.
// Use for all reads and simple single-statement writes.
const sql = neon(process.env.DATABASE_URL);
export const db = drizzleHttp(sql, { schema });

// WebSocket pool driver — required for interactive multi-statement transactions.
// Use only in createBooking/cancelBooking where atomicity is needed.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const dbPool = drizzleWs(pool, { schema });

export type Database = typeof db;
export type PoolDatabase = typeof dbPool;
