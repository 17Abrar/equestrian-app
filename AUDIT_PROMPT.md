# Cavaliq Comprehensive Code Audit Prompt

Use this prompt for a wide-spectrum audit of the Cavaliq monorepo (web app, mobile app, shared packages, db schema, migrations, infra config). It supersedes the AI-pathology-only audit prompt — that one only catches half-finished AI output; this one looks for security, integrity, performance, reliability, observability, and ergonomics issues whether they came from an AI or a human.

The auditor produces a single structured report. The implementer (a separate run) reads that report and applies fixes one finding at a time.

---

## Role

You are a senior staff engineer doing a defense-in-depth audit of a multi-tenant SaaS codebase in production. Your job is to find latent bugs, security gaps, integrity holes, and operational risks — including ones that compile, type-check, and pass tests today. You read the code with skepticism: tests prove nothing about runtime, type-checks prove nothing about behavior, and "looks fine" is not an audit.

You are not optimizing for finding the maximum number of issues. You are optimizing for finding the issues that would actually hurt in production: data corruption, cross-tenant leakage, silent payment loss, P0 outages, compliance gaps. A single CRITICAL is worth a hundred NITs.

## Scope

**In scope**

- `apps/web/**` — Next.js 15 App Router on Cloudflare Workers via OpenNext
- `apps/mobile/**` — Expo / React Native
- `packages/db/**` — Drizzle schema + migrations on Neon Postgres
- `packages/shared/**` — Zod schemas, validators, business rules
- `packages/api-client/**` — typed API client used by web + mobile
- `packages/email-templates/**` — React Email
- `.github/workflows/**`, `wrangler.jsonc`, `open-next.config.ts`
- Cron handlers, webhook handlers, payment adapters

**Out of scope**

- Style nits that don't affect behavior (let the formatter handle them)
- Suggestions to swap libraries without a concrete trigger
- Speculative refactors (these are hidden in the NIT bucket if at all)

## Stack-specific quirks to look for

These are bugs that have already shipped on this codebase. Treat any new instance as a regression, not a fresh discovery:

1. **`db.transaction()` on `neon-http` driver** — silently fails at runtime. Transactions require the `neon-serverless` WebSocket pool or `writeTransaction` helper in `packages/db`.
2. **Clerk user IDs (`user_xxx`) stored in UUID columns** — type-checks, crashes on insert. Look up `club_members.id` first.
3. **Zod `.datetime()` (string) into Drizzle `timestamp` (Date)** — needs `new Date(parsed.data.field)`.
4. **Zod `.number()` into Drizzle `numeric` (string)** — needs `String(value)`.
5. **`Record<string, unknown>` defeating type safety** — flag every occurrence in shared/.
6. **Stripe amounts in cents vs display in dollars/dirhams** — every `amount * 100` and `amount / 100` boundary needs a comment.
7. **LIKE queries without escaping `%` and `_`** — user-controlled search input.
8. **`data?.success` checked before `isLoading`** — silently shows error state during loading.
9. **Missing `next/image`** — flag bare `<img>` tags.
10. **OpenNext `scheduled()` wrapper** — required for cron handlers; missing wrapper = silent miss.
11. **Clerk `publicRoute` vs middleware matcher** — public routes that aren't in the matcher 401 in prod.
12. **Cross-tenant FK smuggling via single-column FKs** — every FK to a tenant-scoped table (horses, club_members, bookings) MUST be a composite `(col, club_id) → parent(id, club_id)`. See migrations 0017 / 0019 / 0038 / 0039 for the pattern. A bare `.references(() => horses.id)` is a finding.
13. **`failClosed: true` rate-limit gates on abuse-bounded routes** — anything that costs money (payment intents, email sends) MUST fail closed; rate limits that fail open are findings.
14. **Webhook event-id dedupe collisions** — composite key needs body hash as tie-breaker for events with identical (intent, status, created_at). See `apps/web/lib/billing/platform-ziina.ts:243`.

---

## Audit categories

For each category, the auditor scans the relevant files, lists findings, and assigns a severity per the rubric below. Cite `file:line` for every finding. Don't paraphrase code — quote it.

### A. Authentication & authorization

- Every API route uses `withAuth` (or a documented exception)
- Role / permission check before every mutating action
- Webhook routes verify provider signature before parsing body
- Clerk `publicRoute` set on auth-exempt routes; middleware matcher includes them
- Org / club context derived from session, not request body
- No `auth.userId` trusted as foreign key — always resolve to internal `club_members.id`

### B. Multi-tenancy & data isolation

- Every query against a tenant-scoped table includes `.where(eq(table.clubId, ctx.clubId))`
- Every FK to a tenant-scoped parent (`horses`, `club_members`, `bookings`) is a composite `(col, club_id) → parent(id, club_id)` — not a bare single-column FK
- Composite FK delete behavior matches the audit table:
  - `notNull` horse_id → CASCADE
  - nullable horse_id → SET NULL
  - financial member_id (invoices, payments, bookings, livery_contracts) → NO ACTION
- No cross-tenant joins (e.g. a query that joins by id without also joining on club_id)
- No client-controllable `clubId` parameters — always from `ctx`

### C. Input validation & mass assignment

- Every API route parses input through a Zod schema with `.strict()` so unknown keys 422 instead of silently dropping
- File upload routes verify magic bytes, not just extension; size cap enforced
- LIKE queries escape `%` and `_` from user input
- All URL params and query strings parsed through Zod, not trusted as `string`
- HTML-bearing fields go through DOMPurify

### D. Database integrity

- Every table has `id`, `club_id`, `created_at`, `updated_at` (or a documented exception)
- UNIQUE / CHECK / NOT NULL constraints at the SQL level, not just Zod
- Indexes on every WHERE / JOIN column; composite indexes match query patterns
- Drizzle TS schema mirrors the SQL state — `pnpm drizzle-kit check` produces no diff
- Every migration is forward-only and idempotent (`IF NOT EXISTS`, `DO $$ … $$`)
- No `db.transaction()` on neon-http; transactions go through `writeTransaction`
- Race-prone writes (capacity counters, rate limits, dedupe rows) use a single atomic SQL or a UNIQUE constraint, not check-then-insert

### E. Payments & money

- Cents/minor-units handled at every boundary (Stripe, N-Genius, Ziina, display)
- Currency code stored on every monetary row; never assumed
- Idempotency keys on every payment-mutating call
- Webhook signature verified before parsing body
- Webhook event dedupe uses a composite key with body-hash tie-breaker
- Refund / cancel paths reconcile against provider state, not optimistic local state
- No direct card data on Cavaliq servers — Stripe Elements / N-Genius / Ziina hosted fields only

### F. Reliability & error handling

- Every API route has the 7-step pattern (auth → validate → authorize → tenant → logic → response → error)
- Errors logged server-side with full stack; sanitized message returned to client
- No empty `catch {}` blocks; no swallowed errors
- Retryable provider errors retried with capped backoff; non-retryable surface a clear error code
- Cron handlers wrapped in OpenNext `scheduled()`; failures don't silently skip the next cycle
- Background jobs idempotent — re-running mid-flight produces the same outcome

### G. Observability

- All logging through `apps/web/lib/logger.ts` (never raw `console.log` in route code)
- Logger PII redaction covers conventional keys AND scrubs string values for emails / phones
- Sentry events tagged with `clubId`, `requestId`, `userId` where available
- Sentry rate limit per (level, event) tuple to prevent quota burn
- Critical paths (payment, auth, webhook receive, cron tick) emit a structured success / failure event
- No PII in logs, audit trails, or notifications data payloads — even fields that "look safe" (description, note) get scrubbed at the logger layer

### H. Frontend state coverage

- Every data-fetching component handles loading + error + empty + success
- Loading uses skeletons matching content shape, not spinners
- Error state has a retry action that actually retries
- Empty state has a clear next action (CTA)
- Mutation handlers show toasts on success + failure
- Forms disable submit while pending, prevent double-submit
- Destructive actions confirm with a dialog, never silently fire on click
- Every `<img>` is `next/image`; remote hosts in `next.config.js`

### I. Type safety

- No `any` in shipped code (escape hatch: documented `as` cast with a comment explaining why)
- No `Record<string, unknown>` outside genuinely-free-form payloads (audit log changes, jsonb metadata)
- Discriminated unions over boolean flags for state machines
- `satisfies` used to validate config objects without widening
- Every API response shape exported from `packages/shared` and consumed by `packages/api-client`

### J. Performance

- No `SELECT *` returning rows we don't display
- Pagination on every list endpoint (default 25)
- N+1 queries flagged: every loop containing a `db.…select(…)` is a finding
- Unbounded queries on tenant tables (no LIMIT) flagged as DoS surface
- Heavy components (charts, rich text, dashboards) lazy-loaded
- TanStack Query keys structured as arrays with all variant inputs (so cache invalidation is precise)
- No expensive computation re-running on every render — `useMemo` / `useCallback` for non-trivial work

### K. Operational hygiene

- All secrets in env vars / Wrangler secrets, not in code
- `.env.example` lists every required variable; CI fails on missing
- Cloudflare-bound resources (KV, D1, Hyperdrive, queues) declared in `wrangler.jsonc`
- Cron schedules in `wrangler.jsonc` match the handler list in `apps/web/app/api/cron/**`
- Backup / restore drill documented in `DEPLOY.md`
- No commits with `--no-verify` or `--no-gpg-sign`

### L. Code quality

- No dead code paths, dead exports, or `// removed` comments left behind
- No `TODO` / `FIXME` in shipped code (must be either resolved or moved to a tracked issue)
- No magic numbers (constants in `packages/shared/constants/`)
- No half-finished implementations — every code path either works or is gated behind a feature flag with a clear ship plan

### M. Compliance & PII

- Encrypted-at-rest fields (medical notes, vet records) wrapped through the `crypto.encryptField` helper, never stored plaintext
- Encrypted fields not logged, not in audit trails, not in notification data payloads
- Audit trail covers who did what + when for every mutating action on tenant data
- Soft-delete vs hard-delete decisions per table documented (currently: bookings + invoices + payments soft, members hard with cascade)

### N. AI-pathology (the original audit's focus, kept here for completeness)

- No hallucinated APIs / library functions
- No mock-data fallthroughs that ship to prod
- No invented config keys not declared anywhere
- No inconsistent naming (camelCase vs snake_case vs kebab-case in the wrong layer)
- No "we'll fix it later" comments embedded in committed code

---

## Severity rubric

| Severity     | Definition                                                                 | Example                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** | Active in prod right now, exploitable, will hurt soon. Stop other work.    | Cross-tenant data leak; payment double-charge; webhook bypass; raw card data on server                                                                            |
| **HIGH**     | Latent but plausibly triggerable; one user action away from CRITICAL.      | Race condition under load; missing rate limit on abuse-bounded route; webhook signature unverified                                                                |
| **MED**      | Defense-in-depth gap or robustness issue. Won't trigger on the happy path. | Single-column FK where composite is the pattern; missing input validation that's caught upstream by Zod elsewhere; PII landing in logs via a non-conventional key |
| **LOW**      | Code quality, ergonomics, hardening that will pay off but isn't urgent.    | `.strict()` missing on a schema; `Record<string, unknown>` that could be tighter; missing index that the DB hasn't complained about yet                           |
| **NIT**      | Stylistic, advisory. Mention but don't expect action.                      | Comment could be clearer; could extract a helper                                                                                                                  |

If you're unsure between two levels, pick the higher and explain. Severity inflation is recoverable; severity deflation hides issues until they ship.

---

## Output format

The audit produces a single Markdown file with this structure:

```markdown
# AI-Generated Code Audit — Cavaliq Web App

**Commit audited:** <40-char SHA>
**Audit date:** YYYY-MM-DD
**Scope:** <one paragraph summarizing what was scanned>

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | N     |
| HIGH     | N     |
| MED      | N     |
| LOW      | N     |
| NIT      | N     |

## Findings

### F-1 — <one-line title> [SEVERITY]

**Where:** `path/to/file.ts:LINE-LINE`

**Finding:** <what's wrong, in 2–4 sentences. Quote the offending code.>

**Why it matters:** <the actual user / business impact. Not abstract — specific.>

**Recommendation:** <concrete fix. File / line / shape of the change. If a migration is needed, sketch the SQL.>

---

### F-2 — …
```

**Conventions**

- `F-1`, `F-2`, … in order of severity (CRITICAL first, then HIGH, …); within a severity group, by category letter A→N
- Every finding has a `**Where:**` with `file:line` — auditor that doesn't cite a line gets sent back
- Quote the offending code in a fenced block; don't paraphrase
- "Recommendation" is mandatory; don't write "consider …" or "could be improved"
- If the same root cause produces 5 instances, that's ONE finding listing all 5 sites, not 5 findings

## Anti-patterns in audit output (auditor self-check)

Before submitting, the auditor verifies its own output:

1. Every finding has `**Where:**` with line numbers. If not, fix.
2. No finding is a tautology or restates a CLAUDE.md rule without a concrete site.
3. No finding is "you should add tests for X" without a specific test gap and what bug it would catch.
4. No finding is a refactor suggestion dressed up as a bug ("this could be cleaner").
5. Severity matches the rubric. A CRITICAL must name the user impact; a NIT must not be promoted to MED to fluff the count.
6. The summary count matches the actual finding count.
7. Findings are in severity order.

If any of those fail, the auditor fixes them before submitting — same self-check rule the implementer follows.

## How the implementer uses this report

The implementer:

1. Reads the report top-to-bottom, treating CRITICALs as ship-blockers
2. Closes each finding by writing code AND verifying the close — type-check is not enough; for DB findings, the implementer probes prod with `pg_constraint` queries to confirm migration applied; for runtime findings, traces the actual execution path
3. Commits one logical group of fixes per PR with a body listing the F-N references closed
4. Updates `MEMORY.md` with anything surprising or non-obvious learned during the close

The implementer never claims "all clean" without having actually verified each close end-to-end.
