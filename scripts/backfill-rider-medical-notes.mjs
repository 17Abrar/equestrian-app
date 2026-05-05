#!/usr/bin/env node
/**
 * 2026-05-05 audit pass-2 — HIGH-3 closure.
 *
 * One-shot encryption backfill for `rider_profiles.medical_notes`.
 *
 * Why this exists separately from the SQL migration runner: Postgres can
 * apply DDL and bulk SQL transformations in a migration, but our
 * application-level AES-256-GCM envelope (`v1:` + base64(IV || tag || ct))
 * with a per-deployment `ENCRYPTION_KEY` cannot be reproduced by pgcrypto
 * — the column would have to be re-encrypted in plaintext-on-the-wire SQL
 * with a key Postgres has access to, which defeats the entire point of
 * field-level encryption. So the encryption itself happens here in
 * Node-land using the exact same `encryptField` shape `packages/db/src/crypto.ts`
 * uses; the matching SQL migration `0034_rider_medical_notes_backfill.sql`
 * is a verifier that aborts if any plaintext rows remain.
 *
 * Idempotent: rows already in `v1:` ciphertext are skipped. Safe to re-run.
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex32> DATABASE_URL_UNPOOLED=postgres://... node scripts/backfill-rider-medical-notes.mjs
 * Or with .env.local present at the repo root: just `node scripts/backfill-rider-medical-notes.mjs`
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

try {
  // Sweep in batches keyed on the primary key. The candidate set is bounded
  // (one row per rider) so a single pass is fine; batching keeps any one
  // statement small and lets us print progress on long tables.
  const candidates = await client.query(
    `SELECT id, medical_notes
       FROM rider_profiles
      WHERE medical_notes IS NOT NULL
        AND medical_notes <> ''
        AND medical_notes NOT LIKE 'v1:%'
      ORDER BY id`,
  );

  const total = candidates.rows.length;
  console.log(`found ${total} rider_profiles row(s) needing encryption backfill`);

  if (dryRun) {
    console.log('dry-run mode: no writes performed');
    process.exit(0);
  }

  if (total === 0) {
    console.log('nothing to do');
    process.exit(0);
  }

  let updated = 0;
  for (const row of candidates.rows) {
    const ciphertext = encryptField(row.medical_notes, key);
    if (!ciphertext) continue;

    // Conditional update: don't overwrite a row another run / writer
    // already migrated. The `<>` and `NOT LIKE` mirror the SELECT.
    const result = await client.query(
      `UPDATE rider_profiles
          SET medical_notes = $1,
              updated_at = now()
        WHERE id = $2
          AND medical_notes IS NOT NULL
          AND medical_notes <> ''
          AND medical_notes NOT LIKE 'v1:%'`,
      [ciphertext, row.id],
    );

    if (result.rowCount === 1) {
      updated += 1;
    }

    if (updated % 100 === 0 && updated > 0) {
      console.log(`progress: encrypted ${updated} / ${total}`);
    }
  }

  console.log(`done: encrypted ${updated} / ${total} row(s)`);
} finally {
  client.release();
  await pool.end();
}
