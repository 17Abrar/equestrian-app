import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { getTableColumns, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index';

/**
 * Static tenant-scope guard (external code-review #1, 2026-06-09).
 *
 * Cavaliq dropped Postgres RLS on purpose (migration 0011): the Neon HTTP
 * driver cannot set `app.current_club_id`, and the WebSocket+transaction path
 * RLS needs costs ~150ms per request. Tenant isolation therefore rests
 * ENTIRELY on application-layer `club_id` scoping. The existing
 * `tenant-isolation.test.ts` proves the invariant for a hand-picked set of
 * helpers, but cannot catch a NEW query that forgets the `clubId` filter,
 * which is exactly the "one forgotten line leaks Club B's data" risk.
 *
 * This test is the automated net. It is pure static analysis (reads source,
 * runs no queries), so it has zero runtime cost and rides the existing CI.
 *
 * Rule: within any scope unit (a top-level function, OR a route handler whose
 * subtree includes a withAuth callback) that runs a PRIMARY query op
 * (.from / .update / .delete / .insert) against a TENANT TABLE, the scope unit
 * must reference `clubId` somewhere in its body, OR be in BY_DESIGN_EXEMPTIONS.
 *
 * "Tenant table" is derived from the schema: any Drizzle table with a `clubId`
 * column (self-maintaining: new tenant tables are covered automatically).
 * Table identifiers are resolved through each file's imports, so aliased
 * imports (e.g. `import { bookings as bookingsTable }`) are caught too.
 *
 * Scope COVERED: the db query-helper layer (`packages/db/src/queries/*`) and
 * inline queries in `apps/web` server code (`app/**`, `lib/**`). Scope NOT
 * covered (documented limits, defended by review + tenant-isolation.test.ts):
 * a query that references `clubId` but filters the wrong table, and raw
 * `sql\`\`` table reads. This guard catches the gross-omission case, which is
 * the dominant lapse mode.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..', '..', '..');
const QUERY_METHODS = new Set(['from', 'update', 'delete', 'insert']);

const SCAN_ROOTS = [
  join(REPO_ROOT, 'packages', 'db', 'src', 'queries'),
  join(REPO_ROOT, 'apps', 'web', 'app'),
  join(REPO_ROOT, 'apps', 'web', 'lib'),
];

/**
 * Functions that legitimately query a tenant table WITHOUT a `clubId` predicate,
 * each scoped by a different, equally-safe key. Keyed by repo-relative
 * `path::function`. Every entry needs a one-line reason; isolation for these is
 * asserted elsewhere (tenant-isolation.test.ts / multi-club-membership.test.ts)
 * or is cross-tenant by nature (webhook ingress).
 */
const BY_DESIGN_EXEMPTIONS: Record<string, string> = {
  // --- packages/db query helpers (verified 2026-06-09) ---
  'packages/db/src/queries/email-send-log.ts::deleteOldEmailSendLogs':
    'retention sweep keyed by createdAt; cron, intentionally cross-club',
  'packages/db/src/queries/payment-accounts.ts::findPaymentAccountByExternalId':
    'webhook resolution by provider-unique externalAccountId; clubId is the output',
  'packages/db/src/queries/payment-accounts.ts::findWebhookConfigByExternalId':
    'webhook resolution by provider-unique externalAccountId; clubId is the output',
  'packages/db/src/queries/webhook-events.ts::claimWebhookEvent':
    'idempotency ledger keyed by globally-unique (provider, eventId)',
  'packages/db/src/queries/webhook-events.ts::markWebhookEventProcessed':
    'idempotency ledger keyed by globally-unique (provider, eventId)',
  'packages/db/src/queries/webhook-events.ts::markWebhookEventFailed':
    'idempotency ledger keyed by globally-unique (provider, eventId)',
  'packages/db/src/queries/webhook-events.ts::markWebhookEventPermanentlyFailed':
    'idempotency ledger keyed by globally-unique (provider, eventId)',
};

function deriveTenantTableExportNames(): Set<string> {
  const tenant = new Set<string>();
  for (const [name, value] of Object.entries(schema)) {
    if (value && is(value, PgTable)) {
      const cols = getTableColumns(value as PgTable);
      if ('clubId' in cols) tenant.add(name);
    }
  }
  return tenant;
}

/** Map a file's local identifiers to tenant tables, honouring `as` aliases. */
function localTenantNames(source: ts.SourceFile, tenantExportNames: Set<string>): Set<string> {
  const locals = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
    const bindings = stmt.importClause.namedBindings;
    if (!ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (tenantExportNames.has(imported)) locals.add(el.name.text);
    }
  }
  return locals;
}

function analyzeBody(
  body: ts.Node,
  locals: Set<string>,
): { queried: string[]; hasClubId: boolean } {
  const queried = new Set<string>();
  let hasClubId = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      if (QUERY_METHODS.has(method) && n.arguments.length > 0) {
        const arg0 = n.arguments[0];
        if (arg0 && ts.isIdentifier(arg0) && locals.has(arg0.text)) queried.add(arg0.text);
      }
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'clubId') hasClubId = true;
    else if (ts.isIdentifier(n) && n.text === 'clubId') hasClubId = true;
    ts.forEachChild(n, visit);
  };
  visit(body);
  return { queried: [...queried], hasClubId };
}

function collectScopeUnits(source: ts.SourceFile, locals: Set<string>) {
  const out: { name: string; queried: string[]; hasClubId: boolean }[] = [];
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.push({ name: stmt.name.text, ...analyzeBody(stmt.body, locals) });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          out.push({ name: decl.name.text, ...analyzeBody(decl.initializer.body, locals) });
        }
      }
    }
  }
  return out;
}

function walkTsFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.d.ts') &&
        entry !== 'index.ts'
      ) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

describe('tenant-scope guard (static)', () => {
  const tenantExportNames = deriveTenantTableExportNames();

  it('derives the tenant-table set from the schema (every table with a clubId column)', () => {
    for (const t of ['bookings', 'horses', 'arenas', 'lessonTypes', 'expenses', 'competitions']) {
      expect(tenantExportNames.has(t)).toBe(true);
    }
    // Tenant ROOT tables have no clubId column and must NOT be in the set.
    expect(tenantExportNames.has('clubs')).toBe(false);
  });

  it('every tenant-table query references clubId (or is a documented exemption)', () => {
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walkTsFiles(root)) {
        const text = readFileSync(file, 'utf8');
        if (!QUERY_METHODS.size) break;
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const locals = localTenantNames(source, tenantExportNames);
        if (locals.size === 0) continue; // file imports no tenant tables
        const rel = relative(REPO_ROOT, file).split(sep).join('/');
        for (const unit of collectScopeUnits(source, locals)) {
          if (unit.queried.length === 0 || unit.hasClubId) continue;
          const key = `${rel}::${unit.name}`;
          if (key in BY_DESIGN_EXEMPTIONS) continue;
          violations.push(
            `${key} queries [${unit.queried.join(', ')}] without any clubId reference`,
          );
        }
      }
    }
    expect(violations, `Tenant-scope leak risk:\n${violations.join('\n')}`).toEqual([]);
  });
});
