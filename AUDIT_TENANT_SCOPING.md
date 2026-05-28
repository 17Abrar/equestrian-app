# Tenant-scoping audit — 2026-05-26

## Methodology

Read EVERY route file under `apps/web/app/api/v1/**` (91 files) end-to-end.
For each route I:

1. Identified the HTTP methods exposed and the DB tables touched.
2. Traced each query — whether inlined in the route or delegated to a
   `packages/db/src/queries/*` helper — to verify the WHERE clause
   includes `eq(<table>.clubId, ctx.clubId)` or, for `/me/*` and
   ownership-aware endpoints, scopes by `clerkUserId` instead.
3. For routes that delegate to `packages/db/src/queries/*`, I opened the
   underlying query file and grepped/read every relevant `export async
   function` to confirm the helper itself enforces `clubId` (defence-in-
   depth) — not just the call site. Files actually opened or grepped:
   `arenas.ts`, `bookings.ts`, `horses.ts`, `horse-health.ts`,
   `club-members.ts`, `riders.ts`, `dashboard.ts`, `reports.ts`,
   `lesson-types.ts`, `clubs.ts`, `finances.ts`, `competitions.ts`,
   `livery-invoices.ts`, `payment-accounts.ts`.
4. For dynamic-segment routes (`[bookingId]`, `[horseId]`, …) I
   verified the row is fetched WITH a `clubId` predicate (not just
   `eq(table.id, param)`).
5. For routes that accept lists of IDs in the body (`emails/send`,
   `register-ownership`, `bookings/create`, `upload`,
   `payments/.../accounts`), I traced every body-supplied id against
   the resolver query to confirm the id is bound to the calling
   user's tenant before any insert/update.

Confidence: HIGH. I opened all 91 route files; for the larger ones
(bookings POST, horse routes, payments) I read the full source plus
their downstream `packages/db` helpers. For helpers covered by the
F-1 / F-9 / F-34 / F-35 / QA-22 audit findings already (composite-FK +
explicit `clubId` predicates), I trusted grep-confirmed presence.

## Summary

- Total route files audited: **91**
- HIGH (tenant leak): **0**
- MEDIUM (defence-in-depth gap): **0**
- LOW / OK: **91** (74 ctx.clubId-scoped + 17 by-design exceptions)

## HIGH findings

**None.** I found no route that reads or mutates a tenant-scoped table
without a `club_id` filter (or an equivalent `clerk_user_id` filter on
`/me/*` user-scoped endpoints).

## MEDIUM findings

**None.** Every `packages/db/src/queries/*` helper I traced re-enforces
`eq(<table>.clubId, clubId)` in its WHERE clause — the call-site
`ctx.clubId` argument is required and used; the helpers are not
relying on the caller's good behaviour. Composite-FK migrations
(`0017`, `0033`, `0041`, `0042`, `0043`, `0044`, `0047`, `0048`) plus
the F-34 sweep ("explicit clubId predicate alongside the composite FK")
have closed the prior gaps. The remaining single-column FKs (e.g.
`expenses.horse_id`, `bookings.horse_id`) are belt-and-braces guarded
by route-side `getHorseById(ctx.clubId, ...)` pre-checks (see
`finances/expenses/route.ts`, `bookings/route.ts:258-263`).

## LOW / by-design notes

The following routes are intentionally NOT club-scoped. They are all
defended via a different mechanism (Clerk userId scoping, public
read-only data, rate-limited unauthenticated intake, NODE_ENV gate,
or signature-verified pre-membership flow):

### `/me/*` — Clerk-userId-scoped (multi-tenant by definition)

- `app/api/v1/me/route.ts` — returns ctx and memberships for the
  signed-in user. No table writes. Memberships query is scoped by
  `clerkUserId`.
- `app/api/v1/me/active-club/route.ts` — POST sets a cookie after
  verifying `(clubId, clerkUserId)` is an active member. CSRF-guarded
  via `isSameOriginRequest`. DELETE mirrors the guard.
- `app/api/v1/me/horses/route.ts` — `getHorsesOwnedByUser(ctx.userId,
  ...)` scopes strictly by Clerk userId across all clubs the user owns
  a horse at.
- `app/api/v1/me/horses/[horseId]/retire/route.ts` — `getHorseOwner-
  shipByUser(ctx.userId, horseId)` is the gate; retires using the
  horse's OWN `clubId`, not `ctx.clubId` (audit F-57 carve-out for
  multi-club owners).
- `app/api/v1/me/livery-invoices/route.ts` — `getLiveryInvoicesOwnedBy-
  User(ctx.userId, ...)` scoped by Clerk userId.
- `app/api/v1/me/profile/route.ts` — read/update against the rider
  profile keyed by `(ctx.clubId, ctx.memberId)`. ctx.clubId IS the
  active tenant.
- `app/api/v1/me/subscription/route.ts` — `getClubById(ctx.clubId)` +
  platform invoices scoped by ctx.clubId.
- `app/api/v1/me/subscription/invoices/[invoiceId]/pay-link/route.ts` —
  `getPlatformInvoiceForEmail(ctx.clubId, invoiceId)` + ctx.clubId-
  scoped `setPlatformInvoiceProviderRef`.

### `/discover/*` — Public, intentionally read-only

- `app/api/v1/discover/clubs/route.ts` — unauthenticated club listing
  via `listPublicClubs`. Returns only `is_public_listing=true` rows.
  IP-rate-limited (20/min, failClosed).
- `app/api/v1/discover/clubs/[slug]/route.ts` — same model; IP-rate-
  limited (60/min, failClosed).

### Pre-membership / unauthenticated intake

- `app/api/v1/clubs/bootstrap/route.ts` — provisions a NEW `(club,
  club_members)` pair for the caller's currently-active Clerk org.
  Pre-membership by definition; cannot use `ctx.clubId`. CSRF-guarded.
  Resolves authoritative org metadata from Clerk's Backend API (not
  request body) to prevent rename via session-replay.
- `app/api/v1/clubs/[slug]/join/route.ts` — rider self-signup. Bypasses
  `withAuth` for the same reason as bootstrap. Validates the target
  club's `join_policy === 'open'` and re-checks via
  `joinClubInstantly()`. Tenant identity is CREATED by this call.
- `app/api/v1/support/contact/route.ts` — public support intake form;
  fan-outs to info@cavaliq.com via Resend. IP-rate-limited (5 per 10
  min, failClosed). No DB writes against tenant tables.
- `app/api/v1/privacy/request/route.ts` — public DSAR intake; same
  posture as support/contact.
- `app/api/v1/account/delete/route.ts` — authenticated (Clerk session)
  but pre-tenant — does NOT use `withAuth`. Sends an ops email to
  info@cavaliq.com for manual GDPR completion. Per-user rate-limited
  (3 per 24h, failClosed).
- `app/api/v1/health/route.ts` — public liveness + deep-readiness
  probe. SELECT 1 / Redis PING only. No tenant tables touched.

### Dev-only / gated

- `app/api/v1/sync-org/route.ts` — explicitly returns 404 when
  `NODE_ENV === 'production'` (verified line 14-19). Used for local
  dev seed only.

## Routes audited and confirmed safe (74)

All are ctx.clubId-scoped throughout the request path:

**Arenas:** `arenas/route.ts`, `arenas/[arenaId]/route.ts`
**Booking slots:** `booking-slots/route.ts`, `booking-slots/[slotId]/route.ts`, `booking-slots/bulk/route.ts`
**Bookings:** `bookings/route.ts`, `bookings/[bookingId]/route.ts`, `bookings/[bookingId]/cancel-preview/route.ts`, `bookings/[bookingId]/complete/route.ts`, `bookings/[bookingId]/no-show/route.ts`, `bookings/[bookingId]/payment/route.ts`, `bookings/[bookingId]/refund/route.ts`
**Competitions:** `competitions/route.ts`, `competitions/[competitionId]/route.ts`, `competitions/calendar/route.ts`, `competitions/[competitionId]/classes/route.ts`, `competitions/[competitionId]/classes/[classId]/route.ts`, `competitions/[competitionId]/classes/[classId]/entries/route.ts`, `competitions/[competitionId]/classes/[classId]/entries/[entryId]/route.ts`, `competitions/[competitionId]/classes/[classId]/results/route.ts`
**Coupons:** `coupons/validate/route.ts`, `finances/coupons/route.ts`, `finances/coupons/[couponId]/route.ts`
**Dashboard:** `dashboard/route.ts`
**Emails:** `emails/audiences/route.ts`, `emails/audiences/[audienceId]/route.ts`, `emails/audiences/preview/route.ts`, `emails/send/route.ts`
**Finances:** `finances/expenses/route.ts`, `finances/expenses/[expenseId]/route.ts`, `finances/invoices/route.ts`, `finances/overview/route.ts`, `finances/payments/route.ts`
**Horses:** `horses/route.ts`, `horses/[horseId]/route.ts`, `horses/[horseId]/approve/route.ts`, `horses/[horseId]/decline/route.ts`, `horses/[horseId]/retire/route.ts`, `horses/[horseId]/owner/route.ts`, `horses/[horseId]/livery-invoices/route.ts`, `horses/[horseId]/documents/route.ts`, `horses/[horseId]/documents/[documentId]/route.ts`, `horses/[horseId]/exercise/route.ts`, `horses/[horseId]/exercise/[scheduleId]/route.ts`, `horses/[horseId]/feeding/route.ts`, `horses/[horseId]/feeding/[planId]/route.ts`, `horses/[horseId]/health/route.ts`, `horses/[horseId]/health/[recordId]/route.ts`, `horses/[horseId]/medications/route.ts`, `horses/[horseId]/medications/[medicationId]/route.ts`, `horses/[horseId]/medications/[medicationId]/logs/route.ts`, `horses/register-ownership/route.ts` (TARGET-CLUB pattern — body's `clubId` is re-validated against active membership inside `registerHorseOwnership`)
**Lesson types:** `lesson-types/route.ts`, `lesson-types/[lessonTypeId]/route.ts`
**Livery invoices:** `livery-invoices/[invoiceId]/cancel/route.ts`, `livery-invoices/[invoiceId]/mark-paid/route.ts`
**Members / staff / owners:** `members/route.ts`, `owners/route.ts`, `owners/[memberId]/route.ts`, `staff/route.ts`, `staff/[memberId]/route.ts`
**Onboarding / settings / reports:** `onboarding/route.ts`, `settings/route.ts`, `reports/route.ts`
**Payment provider connections:** `payments/accounts/route.ts`, `payments/accounts/[provider]/route.ts`, `payments/accounts/set-active/route.ts`, `payments/stripe/connect/route.ts`, `payments/ziina/connect/route.ts`, `payments/n-genius/connect/route.ts`
**Riders:** `riders/route.ts`, `riders/[riderId]/route.ts`
**Uploads:** `upload/route.ts` (verifies `targetClubId` membership when the rider uploads under a different stable), `upload/verify/route.ts` (prefix-binds the R2 key to a club the caller is a member of)

## Notable defence-in-depth patterns observed

These are the patterns that have driven the audit pass to clean:

1. **Helpers ALL take `clubId` as their first positional arg** —
   call sites cannot accidentally call them without supplying it. The
   helper's WHERE clause includes `eq(table.clubId, clubId)` even when
   `(id, clubId)` is already redundant given a composite FK.
2. **Composite FKs on the DB layer (migrations 0017, 0033, 0041, 0042,
   0043, 0044, 0047, 0048)** for horse sub-tables, competition entries,
   audit_log actor refs, and booking↔slot. Belt-and-braces with the
   application-layer filter.
3. **Path-param ↔ resource binding** — every `[bookingId]`,
   `[horseId]`, `[expenseId]` route loads the row via
   `getXById(ctx.clubId, id)` BEFORE acting; the helper either returns
   `null` (404) or returns a row guaranteed to belong to ctx.clubId.
4. **Body-supplied FKs verified inside the route** — `lessonTypeId`,
   `arenaId`, `coachMemberId`, `horseId`, `riderMemberId`, etc. are all
   bound to ctx.clubId before insert. See `booking-slots/route.ts:96-
   117`, `bookings/route.ts:258-263`, `finances/expenses/route.ts:36-
   41`, etc.
5. **`/me/*` endpoints scope by `ctx.userId` (Clerk id)** in helpers
   like `getHorsesOwnedByUser`, `getLiveryInvoicesOwnedByUser`,
   `getActiveMembershipsForUser`. These return rows across MANY clubs
   for the same user — by design — and downstream mutations (e.g.
   `/me/horses/[horseId]/retire`) read the horse's OWN `clubId` and
   pass it into the helper rather than trusting `ctx.clubId`.
6. **Strict role gates on multi-grant routes** — `bookings/route.ts`
   and `competitions/.../entries/route.ts` accept three permission
   grants (staff / self / parent) and narrow each role to the set of
   `riderMemberId`s it's allowed to act on, with `isParentOf(ctx.clubId,
   ctx.memberId, target)` verifying the guardian relationship for the
   parent path.
7. **Idempotent provider-money paths** — `bookings/[id]/refund/route.ts`
   uses `applyProviderRefund` (dedups by `(booking_id,
   provider_refund_id)`) so concurrent admin refunds + webhook replays
   cannot double-count.

## Conclusion

Application-layer tenant scoping is enforced uniformly across all 91
v1 routes. The codebase has clearly survived multiple audit passes
(F-1, F-9, F-34, F-35, QA-22, comprehensive pass, audit rounds 2-6,
pass-3, pass-4, pass-5, pass-6, pass-7) targeted at exactly this
class of bug, and the defence-in-depth posture documented in
CLAUDE.md is in place at the helper layer too. No remediation work
is required from this audit.
