#!/usr/bin/env node
/**
 * Neon point-in-time-recovery (PITR) drill.
 *
 * Audit gap: DEPLOY.md requires that backups be tested, not just
 * configured. This script automates the full restore flow:
 *
 *   1. Read NEON_PROJECT_ID + NEON_API_KEY (must be set in env).
 *   2. Compute a recovery timestamp (default: 1h ago — well within
 *      Neon's 7-day PITR window on the Pro plan, far enough back to
 *      prove "we can rewind").
 *   3. Create a one-shot Neon branch from that timestamp.
 *   4. Run a few read-only sanity queries against it (clubs / bookings
 *      row counts > 0, schema migration table is present).
 *   5. Tear the branch down so we don't accumulate cruft.
 *   6. Print the timestamp + branch id so the operator can paste it
 *      into the "Last restore drill" line in DEPLOY.md.
 *
 * Usage:
 *   NEON_API_KEY=... NEON_PROJECT_ID=sweet-boat-90778968 \
 *     node scripts/restore-drill.mjs
 *
 *   # Restore further back (defaults to 1h):
 *   PITR_HOURS_AGO=24 node scripts/restore-drill.mjs
 *
 * The API key is intentionally NOT stored in .env.local — mint a
 * scoped one on demand at console.neon.tech → Account → API.
 */

import { neon } from '@neondatabase/serverless';

const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const HOURS_AGO = Number(process.env.PITR_HOURS_AGO ?? '1');

if (!NEON_API_KEY) {
  console.error('error: NEON_API_KEY is required.');
  console.error('  mint at https://console.neon.tech/app/settings/api-keys');
  process.exit(1);
}
if (!NEON_PROJECT_ID) {
  console.error('error: NEON_PROJECT_ID is required.');
  process.exit(1);
}
if (!Number.isFinite(HOURS_AGO) || HOURS_AGO < 0.1 || HOURS_AGO > 168) {
  console.error(`error: PITR_HOURS_AGO must be 0.1..168, got ${HOURS_AGO}`);
  process.exit(1);
}

const API = 'https://console.neon.tech/api/v2';

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NEON_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function waitForBranch(projectId, branchId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { branch } = await api('GET', `/projects/${projectId}/branches/${branchId}`);
    if (branch.current_state === 'ready') return branch;
    if (branch.current_state === 'init') {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    throw new Error(`unexpected branch state: ${branch.current_state}`);
  }
  throw new Error(`branch did not become ready within ${timeoutMs}ms`);
}

async function getRwEndpoint(projectId, branchId, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { endpoints } = await api('GET', `/projects/${projectId}/branches/${branchId}/endpoints`);
    const rw = endpoints.find((e) => e.type === 'read_write' && e.current_state === 'active');
    if (rw) return rw;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('no read_write endpoint became active');
}

async function getDatabaseUrl(projectId, branchId, host) {
  const { databases } = await api('GET', `/projects/${projectId}/branches/${branchId}/databases`);
  const db = databases.find((d) => d.name === 'neondb') ?? databases[0];
  if (!db) throw new Error('no databases on branch');
  const { roles } = await api('GET', `/projects/${projectId}/branches/${branchId}/roles`);
  const role = roles.find((r) => r.name === 'neondb_owner') ?? roles[0];
  if (!role) throw new Error('no roles on branch');
  const { password } = await api(
    'GET',
    `/projects/${projectId}/branches/${branchId}/roles/${role.name}/reveal_password`,
  );
  return `postgresql://${role.name}:${password}@${host}/${db.name}?sslmode=require`;
}

async function main() {
  const targetTime = new Date(Date.now() - HOURS_AGO * 3600 * 1000);
  const tag = `drill-${targetTime.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;

  console.log(`restoring project=${NEON_PROJECT_ID} to ${targetTime.toISOString()}`);
  console.log(`branch name: ${tag}`);

  // 1. Create the PITR branch.
  const created = await api('POST', `/projects/${NEON_PROJECT_ID}/branches`, {
    branch: {
      name: tag,
      parent_timestamp: targetTime.toISOString(),
    },
    endpoints: [{ type: 'read_write' }],
  });
  const branchId = created.branch.id;
  console.log(`created branch ${branchId}, waiting for it to be ready…`);

  let success = false;
  try {
    await waitForBranch(NEON_PROJECT_ID, branchId);
    const endpoint = await getRwEndpoint(NEON_PROJECT_ID, branchId);
    const url = await getDatabaseUrl(NEON_PROJECT_ID, branchId, endpoint.host);
    console.log('branch ready, running sanity queries…');

    const sql = neon(url);
    const [v] = await sql`SELECT version() AS v`;
    console.log(`  postgres: ${v.v.split(',')[0]}`);

    const [migs] = await sql`SELECT count(*)::int AS c FROM _migrations`;
    if (migs.c <= 0) throw new Error(`expected migrations on restored branch, got ${migs.c}`);
    console.log(`  _migrations rows: ${migs.c}`);

    const [clubs] = await sql`SELECT count(*)::int AS c FROM clubs`;
    if (clubs.c <= 0) throw new Error(`expected clubs on restored branch, got ${clubs.c}`);
    console.log(`  clubs rows: ${clubs.c}`);

    const [bookings] = await sql`SELECT count(*)::int AS c FROM bookings`;
    console.log(`  bookings rows: ${bookings.c}`);

    success = true;
  } finally {
    console.log(`tearing down branch ${branchId}…`);
    try {
      await api('DELETE', `/projects/${NEON_PROJECT_ID}/branches/${branchId}`);
      console.log('branch deleted');
    } catch (e) {
      console.error(`WARNING: failed to delete branch — clean up at console.neon.tech`);
      console.error(`  ${e.message}`);
    }
  }

  if (success) {
    console.log('');
    console.log('==> RESTORE DRILL PASSED');
    console.log(`    target time: ${targetTime.toISOString()}`);
    console.log(`    update DEPLOY.md "Last restore drill" line accordingly.`);
  } else {
    console.error('==> RESTORE DRILL FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
