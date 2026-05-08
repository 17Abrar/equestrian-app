#!/usr/bin/env node
/**
 * 2026-05-08 audit round 6 — F-2 + F-3 closure.
 *
 * One-shot encryption backfill for the four PHI columns the round-6 audit
 * flagged as plaintext-on-disk:
 *
 *   horse_medication_logs.notes
 *   horse_medication_logs.skip_reason
 *   horse_feeding_plans.notes
 *   horse_exercise_schedules.notes
 *
 * Each is wrapped through the same AES-256-GCM `v1:` envelope the runtime
 * uses (`packages/db/src/crypto.ts:encryptField`) using the same
 * `ENCRYPTION_KEY`. Mirrors `scripts/backfill-rider-medical-notes.mjs` —
 * see that file for the rationale on why this lives in Node-land instead
 * of the SQL migration runner. The matching SQL migration
 * `0048_audit_r6_horse_care_phi_encryption.sql` is a verifier that aborts
 * if any plaintext row remains.
 *
 * Idempotent: rows already in `v1:` ciphertext are skipped. Safe to re-run.
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex32> DATABASE_URL_UNPOOLED=postgres://... \
 *     node scripts/backfill-horse-care-phi.mjs
 * Or with .env.local present at the repo root: just
 *   node scripts/backfill-horse-care-phi.mjs
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

const pool = new Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();

/**
 * One column-family at a time. Each entry names a table, the columns to
 * sweep, and whether the table carries an `updated_at` to bump on write
 * (logs is write-once and lacks one — see schema comment).
 */
const TARGETS = [
  {
    table: 'horse_medication_logs',
    columns: ['notes', 'skip_reason'],
    bumpUpdatedAt: false,
  },
  {
    table: 'horse_feeding_plans',
    columns: ['notes'],
    bumpUpdatedAt: true,
  },
  {
    table: 'horse_exercise_schedules',
    columns: ['notes'],
    bumpUpdatedAt: true,
  },
];

try {
  let grandTotal = 0;
  let grandUpdated = 0;

  for (const target of TARGETS) {
    for (const column of target.columns) {
      const candidates = await client.query(
        `SELECT id, "${column}" AS value
           FROM "${target.table}"
          WHERE "${column}" IS NOT NULL
            AND "${column}" <> ''
            AND "${column}" NOT LIKE 'v1:%'
          ORDER BY id`,
      );

      const total = candidates.rows.length;
      grandTotal += total;
      console.log(`[${target.table}.${column}] found ${total} row(s) needing encryption backfill`);

      if (dryRun || total === 0) continue;

      let updated = 0;
      for (const row of candidates.rows) {
        const ciphertext = encryptField(row.value, key);
        if (!ciphertext) continue;

        const setClause = target.bumpUpdatedAt
          ? `SET "${column}" = $1, updated_at = now()`
          : `SET "${column}" = $1`;

        const result = await client.query(
          `UPDATE "${target.table}"
              ${setClause}
            WHERE id = $2
              AND "${column}" IS NOT NULL
              AND "${column}" <> ''
              AND "${column}" NOT LIKE 'v1:%'`,
          [ciphertext, row.id],
        );

        if (result.rowCount === 1) {
          updated += 1;
        }

        if (updated % 100 === 0 && updated > 0) {
          console.log(`  progress: encrypted ${updated} / ${total}`);
        }
      }

      grandUpdated += updated;
      console.log(`[${target.table}.${column}] done: encrypted ${updated} / ${total}`);
    }
  }

  if (dryRun) {
    console.log(`dry-run complete: ${grandTotal} candidate row(s) across all targets`);
  } else {
    console.log(`done: encrypted ${grandUpdated} / ${grandTotal} row(s) across all targets`);
  }
} finally {
  client.release();
  await pool.end();
}
