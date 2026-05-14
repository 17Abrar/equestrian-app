#!/usr/bin/env node
// Audit pass-10 F-6 (2026-05-14): symmetry check between
// `apps/web/wrangler.jsonc:triggers.crons` and the
// `KNOWN_CRON_TARGETS` object inside `apps/web/worker-entry.mjs`.
//
// The runtime `scheduled()` handler already logs
// `cron_scheduled_unknown_schedule` when a Cloudflare cron fires that the
// targets map can't route — i.e., the wrangler list is ahead of the code.
// But the inverse — a target left in the map after its schedule was
// removed from wrangler — is silent: the route is simply never invoked
// and the only signal is "this cron's effects never happen." Operators
// only notice when billing emails stop landing.
//
// This script runs in CI BEFORE deploy. It parses both files and fails
// the build if the sets disagree. Refusing to ship is cheaper than
// debugging a missing reminder cron a week later.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WRANGLER_PATH = resolve(HERE, '..', 'apps', 'web', 'wrangler.jsonc');
const WORKER_ENTRY_PATH = resolve(HERE, '..', 'apps', 'web', 'worker-entry.mjs');

/**
 * Strip line + block comments from JSONC so JSON.parse can consume it.
 * wrangler.jsonc is hand-written and littered with `//` annotations; the
 * Cloudflare schema is plain JSON though, so this strip is safe.
 */
function stripJsonComments(text) {
  // Block comments first — line stripping is regex-based and might
  // accidentally chop inside a /* ... */ that spans lines.
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // Drop `// ...` to end-of-line, but only when not inside a string.
  // Walk the string char-by-char to avoid mangling `"//"` inside a value.
  let result = '';
  let i = 0;
  let inString = false;
  while (i < out.length) {
    const ch = out[i];
    if (inString) {
      result += ch;
      if (ch === '\\' && i + 1 < out.length) {
        result += out[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && out[i + 1] === '/') {
      // skip to end of line
      while (i < out.length && out[i] !== '\n') i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }
  // Remove trailing commas before `}` / `]`. wrangler.jsonc doesn't have
  // any today, but JSONC formally allows them and the strip should be
  // resilient if a future edit introduces one.
  return result.replace(/,(\s*[}\]])/g, '$1');
}

async function getWranglerCrons() {
  const raw = await readFile(WRANGLER_PATH, 'utf-8');
  const parsed = JSON.parse(stripJsonComments(raw));
  const crons = parsed?.triggers?.crons;
  if (!Array.isArray(crons)) {
    throw new Error(`wrangler.jsonc: triggers.crons is not an array (got ${typeof crons})`);
  }
  return new Set(crons);
}

async function getWorkerKnownCronKeys() {
  const raw = await readFile(WORKER_ENTRY_PATH, 'utf-8');
  // Find the KNOWN_CRON_TARGETS literal and pull its top-level keys.
  // Top-level keys are the schedule strings; anything nested
  // (the `[{ path, label }]` arrays) doesn't match this regex.
  const blockStart = raw.indexOf('KNOWN_CRON_TARGETS');
  if (blockStart === -1) {
    throw new Error('worker-entry.mjs: could not locate KNOWN_CRON_TARGETS');
  }
  const openBrace = raw.indexOf('{', blockStart);
  if (openBrace === -1) {
    throw new Error('worker-entry.mjs: KNOWN_CRON_TARGETS object literal not found');
  }
  // Walk braces to find the matching close. Naive enough — the literal
  // is small and well-formed.
  let depth = 0;
  let end = openBrace;
  for (let i = openBrace; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error('worker-entry.mjs: KNOWN_CRON_TARGETS braces unbalanced');
  }
  const body = raw.slice(openBrace + 1, end);
  // Top-level keys only — match `'<cron-string>'` or `"<cron-string>"`
  // at the start of a line (after indentation).
  const keys = new Set();
  const keyPattern = /^\s*['"]((?:\*|\d|\/|,| |-)+)['"]\s*:/gm;
  let m;
  while ((m = keyPattern.exec(body)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

const setDifference = (a, b) => {
  const out = [];
  for (const v of a) if (!b.has(v)) out.push(v);
  return out;
};

const [wranglerCrons, workerKeys] = await Promise.all([
  getWranglerCrons(),
  getWorkerKnownCronKeys(),
]);

const onlyInWrangler = setDifference(wranglerCrons, workerKeys);
const onlyInWorker = setDifference(workerKeys, wranglerCrons);

if (onlyInWrangler.length === 0 && onlyInWorker.length === 0) {
  console.log(
    `✓ Cron schedule symmetry OK (${wranglerCrons.size} schedules: ${[...wranglerCrons].sort().join(', ')})`,
  );
  process.exit(0);
}

console.error('✗ Cron schedule drift between wrangler.jsonc and worker-entry.mjs:');
if (onlyInWrangler.length > 0) {
  console.error(
    `  In wrangler.jsonc but NOT in KNOWN_CRON_TARGETS (will fire and log unknown_schedule):\n    ${onlyInWrangler.join('\n    ')}`,
  );
}
if (onlyInWorker.length > 0) {
  console.error(
    `  In KNOWN_CRON_TARGETS but NOT in wrangler.jsonc (route will never fire):\n    ${onlyInWorker.join('\n    ')}`,
  );
}
console.error(
  '\nFix one of:\n  - Add the missing schedule(s) to apps/web/wrangler.jsonc:triggers.crons\n  - Remove the orphaned target(s) from apps/web/worker-entry.mjs:KNOWN_CRON_TARGETS',
);
process.exit(1);
