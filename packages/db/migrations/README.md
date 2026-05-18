# Migrations

## Authoritative runner

`scripts/migrate-neon.mjs` (in the repo root) is the **only** runtime that
applies migrations. It iterates `packages/db/migrations/*.sql` in
filename order and applies each `.sql` file whose tag isn't already
present in the `_migrations` tracking table on the target Neon
database. Run via:

```sh
pnpm db:migrate:neon
```

against the unpooled `DATABASE_URL_UNPOOLED` (the pooler can't run
DDL like `CREATE TYPE` or `CREATE INDEX CONCURRENTLY`).

## drizzle-kit is NOT used

`drizzle-kit generate` / `drizzle-kit push` are intentionally not part
of the workflow — they don't play well with Neon's HTTP driver and
they can't sequence the kinds of multi-step migrations we ship
(`ALTER ENUM` rewrites, advisory-lock seeded tables, etc.). We hand-
write each `.sql` file.

`meta/_journal.json` and `meta/0000_snapshot.json` … `0005_snapshot.json`
are residue from when drizzle-kit was last run. **They are not
maintained as the schema evolves** — the snapshot files in particular
are stale (they only reflect the schema circa migration 0005). The
journal itself is updated by hand to keep the file lineage consistent
(see audit I-1, 2026-05-05) but the meta/ contents should not be
treated as the source of truth for the current schema. Drizzle ORM
schema definitions in `packages/db/src/schema/` are authoritative;
the deployed database is the runtime authority.

## Adding a new migration

1. Pick the next `NNNN_short_snake_case_summary.sql` tag.
2. Write the `.sql` file with a top-of-file comment block explaining
   the _why_ (audit reference, incident, schema drift, etc.) and any
   ordering constraints (`SET LOCAL statement_timeout`, advisory locks,
   `IF NOT EXISTS` for idempotency on partial reapplies).
3. Append a matching entry to `meta/_journal.json` with a synthetic
   `when` timestamp greater than the previous entry. (drizzle-kit
   isn't generating these — keep it monotonically increasing.)
4. Update `packages/db/src/schema/*.ts` so the Drizzle ORM matches the
   new physical shape.
5. Run `pnpm db:migrate:neon` against staging first; verify the
   `_migrations` table has the new tag and downstream queries still
   compile (`pnpm typecheck`).
6. Open the PR with both the schema and migration changes in the same
   commit so reviewers don't see the schema-only step in isolation.

## Index creation: prefer `CONCURRENTLY` on high-volume tables

Audit L6 (2026-05-18). The non-concurrent `CREATE INDEX` takes a
`SHARE` lock on the target table for the build duration — concurrent
readers are fine, but concurrent writers block (any INSERT / UPDATE /
DELETE waits for the build to finish because they need to update the
index entries). Fine for JSR-scale tables today, but once a tenant
DB accumulates real volume on tables like `horses`, `bookings`,
`riders`, `audit_log`, `webhook_events`, `payments`, or
`competition_results`, a migration that lands during peak booking
hours can produce a noticeable write-unavailability window.

`migrate-neon.mjs` runs each statement individually via
`client.query()` with no wrapping `BEGIN` (see "Authoritative runner"
above), so `CREATE INDEX CONCURRENTLY` is supported there — unlike
Drizzle Kit migrations which wrap each file in a transaction and
reject `CONCURRENTLY`.

### Caveat — test harness still wraps in an implicit transaction

`packages/db/src/test/harness.ts` boots a fresh PGlite instance per
test and applies each migration via a single `client.exec(sql)` call.
PGlite treats that as an implicit transaction (Postgres's documented
behavior for multi-statement messages on the simple Query protocol),
and `CREATE INDEX CONCURRENTLY` errors out with
`cannot run inside a transaction block`. The harness has no
exclusion / skip mechanism — every journaled `.sql` is applied and
every orphan file fails fast in CI — so a migration that uses
`CONCURRENTLY` will break every test that calls `createTestDb()`
until the harness is updated to split statements like
`migrate-neon.mjs` does.

So the practical rule for now:

- **New migration on a high-volume table?** Bundle the test-harness
  update (split per-statement application matching
  `migrate-neon.mjs`) into the SAME PR as the first migration that
  uses `CONCURRENTLY`. Either change alone is incomplete; together
  they unlock the convention for every subsequent migration.
- **New migration on a low-volume / lookup table?** Use plain
  `CREATE INDEX IF NOT EXISTS …`. Document the choice in the file's
  top comment. No harness change needed.
- **High-volume index migration while the harness is unfixed?** If
  the new index can wait, defer to the harness-fix PR. If it
  genuinely can't wait, use plain `CREATE INDEX` and schedule the
  migration during an off-peak window; document the trade-off in the
  file's top comment.
- **Editing an already-applied migration to add `CONCURRENTLY`?**
  Don't — the tag-tracked `_migrations` row prevents reapplication on
  every existing tenant, so the edit changes nothing in production
  while breaking the test harness. (Migration 0056 is the canonical
  example: see its top comment.)

### Invalid-index recovery for `CONCURRENTLY`

A `CREATE INDEX CONCURRENTLY` build that is interrupted (connection
drop, statement_timeout, deploy rollback) leaves an `indisvalid =
false` row in `pg_index`. On the next run, `IF NOT EXISTS` skips it
and the migration runner records the file as applied — leaving an
unusable performance index in place.

The canonical Postgres recovery — `DROP INDEX CONCURRENTLY` — cannot
run inside a transaction OR inside a `DO $$ ... $$` PL/pgSQL block
(both are tx contexts). So the recovery has to be a top-level
unconditional drop, separated from the create by a statement
breakpoint:

```sql
-- Defensively drop any prior (potentially invalid) build.
-- IF EXISTS makes it a no-op on the common case where no prior
-- attempt exists. Runs only at the top level — never inside DO $$ $$
-- because Postgres rejects DROP INDEX CONCURRENTLY in a tx block.
DROP INDEX CONCURRENTLY IF EXISTS "idx_my_index_name";
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_my_index_name"
  ON "..." ("...");
```

The trade-off is one wasted-DROP per re-apply on a clean DB, which is
acceptable because tag-tracking in `_migrations` prevents re-apply on
the production runner; tests pay the wasted DROP per test but
PGlite's empty-index drop is microseconds.

## Why we don't regenerate meta snapshots

The cost of regenerating the meta snapshots from the current schema is
moderate, but the value is near zero — drizzle-kit isn't on the deploy
path, no tooling consults the snapshots, and a stale snapshot is
strictly less misleading than a freshly-generated-but-soon-to-be-stale
one. If a future ORM upgrade depends on accurate snapshots, that's
the moment to rebuild them as a single bundled task; until then,
fewer files to drift.
