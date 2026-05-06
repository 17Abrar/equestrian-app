#!/usr/bin/env node
/**
 * Audit F-10 (2026-05-06): every dynamic-segment route should validate
 * UUID path params before they reach Drizzle. Without this, a malformed
 * id (`/bookings/foo`) hits Postgres `22P02` and the route's catch-all
 * surfaces a 500 instead of a clean 400.
 *
 * Transformation per route file:
 *   1. Find `const { xxxId, ... } = await params;` lines
 *   2. Insert `validateUuidParam('xxxId', xxxId);` for each Id-shaped var
 *   3. Add `validateUuidParam` to the existing `@/lib/api-utils` import
 *
 * Skips:
 *   - Slug-shaped params (`[slug]`, `[provider]`) — those aren't UUIDs.
 *   - Files that already call `validateUuidParam` (idempotent).
 *
 * Run from repo root:
 *   node scripts/add-uuid-param-validation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SLUG_PARAMS = new Set(['slug', 'provider']);

const files = execSync(
  `find apps/web/app/api/v1 -path '*\\[*\\]*' -name 'route.ts'`,
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

let changed = 0;
let skipped = 0;
for (const file of files) {
  let src = readFileSync(file, 'utf8');

  if (src.includes('validateUuidParam(')) {
    skipped++;
    continue;
  }

  // Match `const { a, b } = await params;`
  const destructureRe = /^(\s*)const\s+\{\s*([^}]+?)\s*\}\s*=\s*await\s+params;/gm;
  let firstMatchIndent = null;
  let didChange = false;

  src = src.replace(destructureRe, (match, indent, vars) => {
    const names = vars.split(',').map((n) => n.trim()).filter(Boolean);
    const uuidVars = names.filter((n) => !SLUG_PARAMS.has(n));
    if (uuidVars.length === 0) return match;
    if (!firstMatchIndent) firstMatchIndent = indent;
    const validations = uuidVars
      .map((n) => `${indent}validateUuidParam('${n}', ${n});`)
      .join('\n');
    didChange = true;
    return `${match}\n${validations}`;
  });

  if (!didChange) continue;

  // Add validateUuidParam to the @/lib/api-utils import
  const importRe = /from\s+'@\/lib\/api-utils'/;
  if (!importRe.test(src)) {
    console.warn(`SKIP (no api-utils import): ${file}`);
    continue;
  }
  // Match the import statement and inject if missing.
  src = src.replace(
    /import\s*\{\s*([^}]+?)\s*\}\s*from\s+'@\/lib\/api-utils'/,
    (m, list) => {
      if (list.includes('validateUuidParam')) return m;
      const newList = list.trim().replace(/,?\s*$/, '') + `, validateUuidParam`;
      return `import { ${newList} } from '@/lib/api-utils'`;
    },
  );

  writeFileSync(file, src);
  changed++;
  console.log(`ok    ${file}`);
}

console.log(`\n${changed} file(s) updated, ${skipped} already done.`);
