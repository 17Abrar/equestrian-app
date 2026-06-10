# Audit Pass 11 — Full-Assurance Multi-Agent Review (2026-06-06)

## Method

Full-repo audit driven by a multi-agent workflow: the monorepo was split into
**18 shards** covering every source area (web app, DB schema/queries/migrations,
shared, api-client, email-templates, mobile, scripts, config/CI). Each shard ran
a three-stage pipeline:

1. **Audit** — an agent read every file in the shard in full and reported
   findings across five dimensions: correctness, security (incl. tenant
   scoping), dead code, clarity/jargon, and version/doc correctness.
2. **Adversarial verify** — a second agent independently re-read the cited code
   and refuted false positives, correcting severity where needed.
3. **Codex cross-check** — for shards with confirmed critical/high findings, the
   Codex CLI independently re-judged each one and looked for missed issues.

**Coverage:** 518 files read. **85 raw findings → 84 confirmed** (1 rejected as a
false positive). Severity: **0 critical, 8 high, 17 medium, 59 low**. Codex
agreed with every high-severity finding it reviewed.

## Baseline (pre-change)

- typecheck: green for web, db, shared, api-client, email-templates; mobile
  failing (pre-existing).
- All fixes were applied on branch `audit/full-assurance-2026-06-06`.

## Verification (post-change)

- **typecheck:** green for web, db, shared, api-client, email-templates.
  Mobile remains blocked **only** by a pre-existing third-party dependency
  packaging bug (see Deferred D-6); my changes strictly improved mobile by
  removing the prior `react-native-mmkv` error.
- **tests:** 417 passing (shared 123, web 148, db 146).
- **lint:** 6/6 packages, 0 errors (4 pre-existing `request.json()` warnings in
  untouched routes).

## Housekeeping (working-tree cleanup)

Removed 17 untracked Finder/iCloud duplicate artifacts (`filename 2.ext`,
`filename 3.ext`) that were polluting the tree, after verifying each was either
byte-identical to its source or stale-and-unreferenced. Notably this included
**two stray copies of migration `0061`** (one a divergent older version) — a real
`drizzle migrate` foot-gun — and stale superseded `page 2/3.tsx`. Also deleted
the unused `apps/mobile/lib/storage.ts` (imported the uninstalled
`react-native-mmkv`).

---

## Fixes applied (this PR)

### High severity

| ID                       | File                                           | Fix                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth-tenant-1            | `app/api/webhooks/clerk/route.ts`              | **Security:** `organizationMembership.created` upsert could resurrect an admin-kicked member. Added the `CASE WHEN deactivated_by_admin_at IS NULL` guard used everywhere else so a webhook/Svix redelivery can't reactivate a kicked member. |
| people-1                 | `components/riders/rider-profile.tsx`          | Passed `rider.id` (profile UUID) where a `club_members.id` was required, leaving the Bookings/Progress tabs permanently empty. Now passes `rider.memberId`.                                                                                   |
| horses-1                 | `components/horses/pending-approval-card.tsx`  | Hardcoded `*100` mis-billed 3-decimal currencies (KWD/BHD/OMR) by 10x on ownership approval. Now uses `toMinorUnits(fee, clubCurrency)`.                                                                                                      |
| competitions-community-1 | `db/src/queries/competitions.ts`               | Registration was allowed against draft/completed/soft-deleted competitions (only `cancelled` was rejected). Now requires `isActive` and status in `{published, in_progress}`.                                                                 |
| arenas-lessons-dash-1    | `db/src/queries/reports.ts`                    | Horse-utilization report ignored the date range (counted `bookings.id` off the un-dated join). Now counts the date-filtered `bookingSlots.id`.                                                                                                |
| arenas-lessons-dash-2    | `components/lesson-types/lesson-type-form.tsx` | Create form rejected fractional prices (resolver used the integer minor-unit API schema). Added a major-unit form schema; converts via `toMinorUnits` on submit.                                                                              |
| config-scripts-1         | `scripts/backfill-pass-2-phi.mjs`              | PHI backfill unconditionally set `updated_at` on `horse_documents`, which has no such column → 42703 aborts the whole backfill (leaves PHI unencrypted). Added `bumpUpdatedAt: false` for write-once tables.                                  |
| db-migrations-1          | (deferred — see D-1)                           | Editing an already-applied migration carries checksum risk; documented for sign-off.                                                                                                                                                          |

### Medium severity

| ID                    | File                                           | Fix                                                                                                                                     |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| auth-tenant-2         | `lib/safe-href.ts`                             | Protocol-relative `//evil.com` slipped through the path-passthrough (open-redirect). Now rejected, matching `safe-redirect.ts`.         |
| payments-1            | `app/api/webhooks/resend/route.ts`             | Resend webhook had no rate limit (every sibling webhook fails closed). Added IP-keyed `failClosed` limiter.                             |
| shared-1              | `shared/src/schemas/index.ts`                  | Photo/document URL fields used bare `z.string().url()` (accepts `javascript:`). Switched to the `httpsUrl` scheme guard.                |
| web-infra-1           | `lib/env-check.ts`                             | `R2_PUBLIC_URL` (an upload origin-pin / security boundary) was missing from the production required-env gate. Added.                    |
| arenas-lessons-dash-3 | `components/reports/reports-page.tsx`          | "Bookings" card counts only paid/partial; relabelled "Paid Bookings" to match the data.                                                 |
| arenas-lessons-dash-5 | `components/lesson-types/lesson-type-form.tsx` | Edit dialog `*100` / `/100` mis-scaled non-AED currencies. Now uses `toMinorUnits`/`toMajorUnits` keyed off the lesson type's currency. |
| bookings-1            | `components/calendar/day-view.tsx`             | Day view dropped slots outside 06:00–22:00. Widened to a full 24-hour grid.                                                             |
| bookings-2            | `components/bookings/add-booking-dialog.tsx`   | Offered "Package Credit", which the API hard-rejects (422). Removed the dead option.                                                    |
| emails-1              | `components/emails/audiences-tab.tsx`          | Audiences list silently truncated to the default 25. Now requests `pageSize=50` (full pagination UI tracked as follow-up).              |

### Low severity (mechanical / clarity)

`mobile-1` booking `mutateAsync` now wrapped in try/catch (token-refresh
rejection feedback) · `mobile-2` week navigation re-syncs `selectedDate` ·
`mobile-3/4/5` removed unused `storage.ts`, `CavaliqMark`, and skeleton exports ·
`db-schema-3` `decryptFields` null-row guard · `shared-2` `formatTime` finite
guard (was `NaN`) · `emails-4` zero-padded minutes in email template ·
`web-ui-2` footer "Acceptable use" link fixed to `/legal/acceptable-use` ·
`auth-tenant-3` / `auth-tenant-5` / `payments-2/3/4/6` / `web-infra-3` /
`config-scripts-5` / `db-queries-2` stale-comment + dead-code cleanups.

---

## Deferred items — resolved after sign-off (Pass 11b, 2026-06-06)

After operator clarification on each, all seven deferrals were actioned:

- **D-1 (resolved):** new idempotent forward migration
  `0067_audit_pass_11_horse_leases_idempotent.sql` — guards `CREATE TYPE` in
  `DO/EXCEPTION`, `CREATE TABLE/INDEX IF NOT EXISTS`, breakpoint-delimited.
  No-op where 0064 applied correctly; self-heals the fork scenario. 0064 left
  untouched (no journal-hash break). Validated: applies cleanly on PGlite via
  the db test harness.
- **D-2 (resolved):** added `unmarkInvoiceReminder` (CAS-guarded reminder-count
  rollback) and call it on both livery-billing send-failure paths, so a
  transient Resend outage retries next pass instead of burning the threshold.
- **D-3 (resolved, FK only):** migration
  `0068_audit_pass_11_email_send_log_audience_fk.sql` adds `audiences (id,
club_id)` UNIQUE and promotes `email_send_log.audience_id` to a composite
  `(audience_id, club_id)` FK. `ON DELETE NO ACTION` (club_id is NOT NULL);
  `deleteAudience` now nulls the log reference in the same transaction first,
  preserving prior behavior. Drizzle schema TS updated to match. The
  `updated_at` backfill no-ops were intentionally NOT changed (cosmetic, no data
  loss, re-run wouldn't help).
- **D-4 (resolved):** Lesson Popularity now excludes cancelled bookings,
  consistent with the other reports.
- **D-5 (resolved):** the DB is in **AWS `ap-southeast-1` (Singapore), not the
  EU** — the FAQ's "database in the EU" claim was false. Corrected to the actual
  region. (Operator may revisit positioning / a regional Neon move separately.)
- **D-6 (resolved):** not a package/library problem — the local pnpm store copy
  of `react-native-toast-message` was corrupted (missing `lib/index.*`). A clean
  reinstall restored it; no code/dependency change. See the mobile note below.
- **D-7 (resolved):** deleted the orphaned `apps/web/components/marketing/`.

### Pass 11c — Codex cross-check refinements (2026-06-07)

An independent Codex review of the full branch surfaced two items, both actioned:

- **Lesson-type create form hardcoded `AED`** (pre-existing): a non-AED club's
  lesson types were created with the wrong currency. The create dialog now reads
  the club currency from settings (like the ownership-approval fix) and converts
  with `toMinorUnits` keyed off it.
- **Migration `0068` idempotency:** its `ALTER TABLE ... ADD CONSTRAINT`
  statements relied on the migrate-neon runner swallowing duplicate-constraint
  errors rather than guarding them in SQL, so it wasn't truly idempotent across
  runners despite advertising itself as such. Each ADD is now wrapped in the
  `DO/EXCEPTION duplicate_object` guard (matching `0067`); re-validated on PGlite.

### Mobile — Expo SDK 53 alignment (2026-06-07)

The mobile dependency manifest had drifted incoherent (`expo@53` core with
`expo-*` modules at 55.x, `react-native@0.85.3`, `@types/react@19.2`), which
produced React-19 JSX-type errors on a clean lockfile install. Ran
`expo install --fix` to realign every dependency to SDK 53 (`react-native@0.79.6`,
SDK-53 `expo-*` modules, sentry/vector-icons), and deliberately kept
react/react-dom/@types/react at 19.2.x (pinned via `expo.install.exclude`)
because `@clerk/clerk-expo` requires React 19.2.3+ and the whole workspace shares
one `@types/react` version (mixing 19.0/19.2 broke web's JSX types via hoisting).
Mobile now typechecks green; `expo install --check` reports dependencies up to
date.

The one remaining recommendation is a device/simulator build smoke test of the
mobile app: the dependency realignment is type-clean and Expo-validated, but a
runtime build (`expo start` / EAS) on a device is the final confirmation that the
SDK-53 module versions behave at runtime. That requires a device and is outside
this environment.

## Original deferred list (for reference)

These were the findings flagged before sign-off; see the resolutions above.

- **D-1 (high) — `migrations/0064_horse_leases.sql`:** bare `CREATE TYPE` with no
  guard. On a Neon test-branch fork the swallowed `duplicate_object` aborts the
  single-statement file, so `horse_leases` + indexes are never created yet 0064
  is recorded as applied. _Recommended:_ a new forward migration that
  idempotently creates the table/indexes if missing (don't edit applied history).
- **D-2 (medium) — `cron/livery-billing`:** overdue-reminder burns
  `reminder_count` before send and never rolls back on transient email failure
  (siblings do). Needs an `unmarkInvoiceReminder` CAS helper, or an explicit
  "burn is intended" comment like the platform-invoice path.
- **D-3 (medium) — `db-migrations-3/4`:** the `updated_at` backfills in
  0044/0047/0049 are silent no-ops (NOW() default never matches the
  `< created_at` predicate); and `email_send_log.audience_id` is a single-column
  FK not bound to `club_id` (needs an `audiences(id, club_id)` unique + composite
  FK). Both are history/schema migrations — review before writing forward fixes.
- **D-4 (medium) — `arenas-lessons-dash-4`:** Lesson-Popularity counts cancelled
  bookings, diverging from the other reports. Confirm intended product semantics.
- **D-5 (low) — `web-ui-5`:** FAQ hard-claims the database is in the EU; the
  status/security pages say "Neon" with no region. Legal/marketing accuracy call.
- **D-6 (pre-existing, environmental) — mobile typecheck:**
  `react-native-toast-message@2.3.3`'s `package.json` points `main`/`types` at
  `./lib/index.*` but it builds to `./lib/src/*` (no `index.*` exists), so `tsc`
  can't resolve it. Runtime (Metro) is unaffected. _Recommended:_ pin to a
  version whose package metadata matches its build output, or add a typed module
  shim. Not masked with an `any` shim (that would be its own regression).
- **D-7 (low) — `components/marketing/`:** orphaned `WaitlistForm` +
  `marketing-footer` (untracked WIP) posting to a non-existent
  `/api/v1/marketing-waitlist`. Delete if no waitlist is planned, or wire up the
  route + page. Left in place as it appears to be in-progress work.
- Remaining low-severity nits (n-genius refund dedup, broadcast daily-cap
  refund, several stale comments) are catalogued in the per-shard results.
