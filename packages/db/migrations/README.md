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
   the *why* (audit reference, incident, schema drift, etc.) and any
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

## Why we don't regenerate meta snapshots

The cost of regenerating the meta snapshots from the current schema is
moderate, but the value is near zero — drizzle-kit isn't on the deploy
path, no tooling consults the snapshots, and a stale snapshot is
strictly less misleading than a freshly-generated-but-soon-to-be-stale
one. If a future ORM upgrade depends on accurate snapshots, that's
the moment to rebuild them as a single bundled task; until then,
fewer files to drift.
