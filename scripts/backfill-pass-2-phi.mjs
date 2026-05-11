#!/usr/bin/env node
/**
 * 2026-05-09 audit pass-2 — PHI encryption-at-rest sweep (B-1, B-3..B-6).
 *
 * Encrypts every plaintext PHI/PII column added to the encrypted-fields
 * lists in this round in-place. Mirrors the AES-256-GCM envelope
 * `packages/db/src/crypto.ts:encryptField` writes (`v1:` + base64(IV ||
 * tag || ciphertext)) and the same `ENCRYPTION_KEY` the runtime uses.
 *
 * Companion to:
 *   * `migrations/0052_audit_pass_2_phi_widen_columns.sql` (varchar→text).
 *
 * NOTE — verifier-migration follow-up still open (pass-5 docstring
 * correction, 2026-05-10): the older PHI encryption rounds shipped a
 * SQL verifier in pair with each backfill (see migrations 0034 and
 * 0048 — both `RAISE EXCEPTION` if plaintext rows remain) so a missed
 * backfill couldn't slip through deploy. Pass-2 deferred the verifier
 * because the deploy pipeline runs migrations BEFORE app code, and a
 * verifier in the same release as the encrypt-on-write code would have
 * blocked its own deploy. The follow-up (a verifier migration shipped
 * AFTER prod is confirmed clean) was never written — there is currently
 * no DB-level gate proving the pass-2 backfill ran. If a future
 * operator restores from a pre-backfill snapshot, or hand-edits SQL,
 * plaintext PHI re-lands in these columns with no detection.
 *
 * Idempotent: rows already in `v1:` ciphertext are skipped. Safe to
 * re-run.
 *
 * Tables/columns covered:
 *   * rider_profiles.emergency_contact_name
 *   * rider_profiles.emergency_contact_phone
 *   * rider_profiles.emergency_contact_relation
 *   * horse_medications.prescribed_by
 *   * bookings.coach_notes  (no production write path yet — typically zero rows)
 *   * horse_documents.description
 *   * horses.markings
 *   * horses.notes
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex32> DATABASE_URL_UNPOOLED=postgres://... node scripts/backfill-pass-2-phi.mjs
 * Or with .env.local present at the repo root: just `node scripts/backfill-pass-2-phi.mjs`
 *
 * Flags:
 *   --dry-run   Read + report counts but do not write
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- env loader (mirrors scripts/migrate-neon.mjs:loadEnvLocal) ----------
function loadEnvLocal() {
  const envPath = path.resolve(here, '..', '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('error: DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL must be set.');
  process.exit(1);
}

// --- crypto (mirrors packages/db/src/crypto.ts:encryptField) -------------
const VERSION_PREFIX = 'v1:';
const IV_LEN = 12;

function loadKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. The backfill must encrypt with the same key the app uses, otherwise reads will return null.',
    );
  }
  if (process.env.NODE_ENV === 'production' && /^0+$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY in production is the all-zeros placeholder. Refusing to encrypt PHI with a known-test key.',
    );
  }
  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars).',
    );
  }
  return key;
}

function encryptField(plaintext, key) {
  if (plaintext == null || plaintext === '') return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

// --- run -----------------------------------------------------------------
const dryRun = process.argv.includes('--dry-run');
const key = loadKey();

const TARGETS = [
  { table: 'rider_profiles',   pk: 'id', column: 'emergency_contact_name' },
  { table: 'rider_profiles',   pk: 'id', column: 'emergency_contact_phone' },
  { table: 'rider_profiles',   pk: 'id', column: 'emergency_contact_relation' },
  { table: 'horse_medications', pk: 'id', column: 'prescribed_by' },
  { table: 'bookings',         pk: 'id', column: 'coach_notes' },
  { table: 'horse_documents',  pk: 'id', column: 'description' },
  { table: 'horses',           pk: 'id', column: 'markings' },
  { table: 'horses',           pk: 'id', column: 'notes' },
];

const pool = new Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();

let grandTotalCandidates = 0;
let grandTotalUpdated = 0;
const summary = [];

try {
  for (const t of TARGETS) {
    const candidates = await client.query(
      `SELECT ${t.pk} AS pk, ${t.column} AS plaintext
         FROM ${t.table}
        WHERE ${t.column} IS NOT NULL
          AND ${t.column} <> ''
          AND ${t.column} NOT LIKE 'v1:%'
        ORDER BY ${t.pk}`,
    );

    const total = candidates.rows.length;
    grandTotalCandidates += total;
    console.log(`[${t.table}.${t.column}] found ${total} plaintext row(s)`);

    if (dryRun || total === 0) {
      summary.push({ ...t, total, updated: 0 });
      continue;
    }

    let updated = 0;
    for (const row of candidates.rows) {
      const ciphertext = encryptField(row.plaintext, key);
      if (!ciphertext) continue;

      // Conditional update: don't overwrite a row another run / writer
      // already migrated.
      const result = await client.query(
        `UPDATE ${t.table}
            SET ${t.column} = $1,
                updated_at = now()
          WHERE ${t.pk} = $2
            AND ${t.column} IS NOT NULL
            AND ${t.column} <> ''
            AND ${t.column} NOT LIKE 'v1:%'`,
        [ciphertext, row.pk],
      );

      if (result.rowCount === 1) {
        updated += 1;
      }

      if (updated % 100 === 0 && updated > 0) {
        console.log(`  progress: ${updated} / ${total}`);
      }
    }

    grandTotalUpdated += updated;
    summary.push({ ...t, total, updated });
    console.log(`  done: encrypted ${updated} / ${total} row(s)`);
  }

  console.log('');
  console.log(`grand total candidates: ${grandTotalCandidates}`);
  console.log(`grand total updated:    ${grandTotalUpdated}`);
  if (dryRun) console.log('dry-run mode: no writes performed');
} finally {
  client.release();
  await pool.end();
}
