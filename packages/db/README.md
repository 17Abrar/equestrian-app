# @equestrian/db

Drizzle ORM schema, migrations, queries, and tenant context helpers for Cavaliq.

## Migrations are hand-written

`drizzle-kit generate` is **disabled** in this package (the `db:generate` script
errors out with an explanation). The reason is in audit Round 5 / F-41:

- `packages/db/migrations/meta/_journal.json` correctly tracks all 47
  migrations (`0000`..`0046` at the time of writing).
- The companion `<idx>_snapshot.json` files only exist for `0000..0005`.
- drizzle-kit uses these snapshots to compute the SQL-vs-TS diff.
  Without them the diff baseline is `0005_snapshot.json`, so a fresh
  `generate` run would emit a single migration that drops + recreates
  everything added by `0006`..`0046` — a catastrophic destructive diff.

Every migration since `0006` has been hand-written, and the corresponding
TS schema in `packages/db/src/schema/` is updated by hand alongside the
SQL. Audit rounds keep TS in sync with SQL via dedicated drift-sweep PRs
(round 4 PR Iota, round 5 PR Pi).

## Adding a new schema change

1. Hand-write the SQL migration in `packages/db/migrations/<NNNN>_<name>.sql`
   following the conventions of recent migrations (`BEGIN; … COMMIT;`,
   `IF EXISTS` / `IF NOT EXISTS` / `DO $$ … $$` guards for idempotency).
2. Append the entry to `packages/db/migrations/meta/_journal.json`
   (next `idx`, monotonic `when` value, matching `tag`).
3. Mirror the change in `packages/db/src/schema/<table>.ts`.
4. Apply locally via `pnpm db:migrate` (or `db:migrate:neon` for the
   ephemeral neon test branch).
5. Run `pnpm --filter=@equestrian/db test` to validate the schema's
   typecheck and exercise queries against pglite.

## Recovery path: regenerating snapshots

If you ever need `drizzle-kit generate` to work again, the recovery is:

1. Provision a clean Postgres branch.
2. Run `pnpm db:migrate` end-to-end to apply all 47+ migrations.
3. Run `drizzle-kit introspect` to produce snapshots from the live SQL state.
4. Commit `0006_snapshot.json` … `<latest>_snapshot.json`.
5. Re-enable the real `drizzle-kit generate` in `package.json`.

That's not a tax we want to pay piecemeal — bundle it with a future
schema-tooling pass.
