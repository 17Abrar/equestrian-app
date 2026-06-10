# Cavaliq Functionality Audit — 2026-05-26

This is a feature-walkthrough audit (not a code-quality audit). It traces every
route end-to-end (schema → query → API → hook → component → UI) and flags places
where a real user would hit a broken / missing flow.

## Executive summary

- **Total findings: 41** (P0: 4, P1: 14, P2: 23)
- The platform is structurally solid: dashboard, bookings, horses, calendar,
  riders, staff, owners, finances, competitions, settings, and the rider portal
  are all wired through real APIs with proper permission gates, tenant scoping
  via `getTenantContext`, loading / error / empty states, and toast feedback.
  Audit passes 1–7 cleaned up nearly all code-level issues.
- The biggest gaps are at the **edges**, not the core: a missing public landing
  page (`/`), Community tabs that are explicit "coming soon" stubs on web and
  mobile, a mobile Horses tab that calls the wrong endpoint for riders, and the
  Emails composer that cannot actually target Audiences (the second tab on the
  same page).
- No tenant leaks were found. The four P0s are about flows that are broken or
  stubbed, not security holes.

### Top 5 ship-blockers (P0)

1. **No page at `/`** — `apps/web/app/` has no root `page.tsx`. The Clerk sign-in
   `forceRedirectUrl` sends users to `/dashboard` or `/rider`, but every public
   surface that links `href="/"` (CavaliqLogo from `select-org`, `not-found`,
   `discover`, every public header, every mobile-app `/legal` link target back
   to the marketing site, etc.) lands on the branded 404. The rider layout
   even comments "the public marketing page took over the root URL" — but it
   was never built.
2. **Community is a placeholder** on both web (`/community`, `/rider/community`)
   and mobile (`(tabs)/community.tsx`). Three of the 29 surveyed features
   ship as "Coming soon" cards. Product plan lists community as a Phase 1
   deliverable.
3. **Mobile Horses tab calls the wrong endpoint for riders.** Mobile
   `app/(tabs)/horses.tsx` calls `useHorses()` → `GET /api/v1/horses`, which
   is gated by `horses:read`. Rider role has `horses:read_own` only and will
   receive a 403. The rider-scoped endpoint `/api/v1/me/horses` already
   exists (used by the web rider portal) but the mobile hook does not call
   it. Every mobile rider opening the Horses tab hits an error state.
4. **Emails: Audiences cannot be used.** The Compose form takes a single
   `to: email` field. Audiences are a sibling tab but there is no UI to send
   to one — no audience picker, no broadcast endpoint, no batch send. The
   Audiences feature is therefore decorative.

### Overall health

The day-1 flows for a stable admin (sign up, onboard, create slot, take a
booking, accept payment, refund, run a report, send a one-off email) all
work. The day-1 flow for a rider on **web** also works. The day-1 flow for a
rider on **mobile** is broken on the Horses tab. The public marketing /
landing experience is a 404 unless the visitor types `/discover` directly.
Most of the smaller gaps are coming-soon stubs, missing nav links, or
single-currency assumptions on Reports that the per-currency finances
dashboard already solved.

---

## Findings by feature

### 1. Auth + onboarding

- **Status:** Works
- **Files traced:** `app/(auth)/sign-in/[[...sign-in]]/page.tsx`,
  `app/(auth)/sign-up/[[...sign-up]]/page.tsx`,
  `app/select-org/page.tsx`,
  `app/start-club/page.tsx`,
  `app/onboarding/page.tsx`,
  `app/(dashboard)/layout.tsx`,
  `app/rider/layout.tsx`,
  `app/api/v1/clubs/bootstrap/route.ts`,
  `lib/tenant.ts`,
  `middleware.ts`
- **P0 findings:**
  - The sign-up `?as=stable` flow ultimately routes through `/start-club` →
    `/api/v1/clubs/bootstrap` → `/onboarding`. This is well-built (PR #123
    closed the webhook race). However, the sign-up `signInUrl` for stable
    users defaults to `/sign-in?as=stable`, and the `signInForceRedirectUrl`
    sends them to `/dashboard` — which works. Confirmed not a regression.
- **P1 findings:**
  - The `/onboarding` STEP indicator lists 5 steps (Welcome, Arenas, Lessons,
    Payments, Staff). All five are well-formed RHF + Zod forms. The "Payments"
    step (Stripe / Ziina / N-Genius connect) is optional and "Staff" can be
    skipped — verified at `app/onboarding/page.tsx:834` ("Skip & Finish").
  - `lib/clerk-org-membership.ts` / `clerk-roles.ts` map Clerk org roles to
    Cavaliq roles. Default for any Clerk member that isn't `org:admin` is
    `rider`. A grom / coach / manager invited via the in-app Staff page is
    fine; one invited from Clerk's dashboard directly will land in the rider
    portal until manually fixed.
- **P2 findings:**
  - `/select-org` and `/start-club` both link home with `<Link href="/">` but
    `/` does not resolve — see #16.
  - `sync-org` route (untracked dev-only POST) is correctly guarded by
    `NODE_ENV !== 'production'` (`NODE_ENV` is statically set in
    `cloudflare-env.d.ts`), so the production worker returns 404.

### 2. Dashboard home

- **Status:** Works
- **Files traced:** `app/(dashboard)/dashboard/page.tsx`,
  `components/dashboard/dashboard-overview.tsx`,
  `hooks/use-dashboard.ts`,
  `app/api/v1/dashboard/route.ts`
- **P0:** None.
- **P1:** None.
- **P2:**
  - Stat cards are clickable cards that navigate to `/bookings`, `/horses`,
    etc. — no per-card empty state when totals are 0. Visually fine but a
    brand-new club sees four "0" cards on first load. Could add a quick-start
    guide overlay.
  - The list of "Upcoming bookings (next 5)" rendered below the stat grid
    correctly handles loading / error / empty.

### 3. Calendar

- **Status:** Works
- **Files traced:** `components/calendar/calendar-view.tsx`, four view files
  (day / week / month / agenda), `create-recurring-slots-dialog.tsx`,
  `create-single-slot-dialog.tsx`, `hooks/use-calendar-state.ts`,
  `app/api/v1/booking-slots/route.ts`,
  `app/api/v1/booking-slots/bulk/route.ts`
- **P0:** None.
- **P1:**
  - Week view starts on a configurable day via `lib/ui-constants.WEEK_STARTS_ON`,
    and bookings list now mirrors it — fixed in the prior audit. The rider
    `book.tsx` page still uses its own ISO-Monday-start computation in
    `getWeekDates`, which is a small inconsistency for non-Monday clubs but
    not visible to non-admin riders today.
- **P2:**
  - No "drag to create" or "drag to move" — slots can only be created via
    the dialogs. Acceptable for v1.
  - No print / iCal export from this view.

### 4. Bookings

- **Status:** Works
- **Files traced:** `app/(dashboard)/bookings/page.tsx`,
  `components/bookings/bookings-list.tsx`,
  `add-booking-dialog.tsx`,
  `app/api/v1/bookings/route.ts`,
  `app/api/v1/bookings/[bookingId]/{cancel-preview,complete,no-show,payment,refund}/route.ts`
- **P0:** None.
- **P1:**
  - The "Add Booking" path lets a coach with `bookings:update_own` see the
    button hidden, but the underlying API enforces 403 in either case.
    Verified `canCreate` gate is server-side.
  - The refund flow uses inline mutation; the refund result is shown as a
    warning toast if pending — good.
- **P2:**
  - `payment` action menu is only shown when `paymentStatus === 'paid'` →
    no inline "Mark paid offline" entry from the admin row dropdown. Manual
    flow is via the Add Booking dialog only.

### 5. Horses

- **Status:** Works
- **Files traced:** `components/horses/horses-list.tsx`,
  `horse-profile.tsx`, `horse-form.tsx`,
  `health-tab.tsx`, `feeding-tab.tsx`, `exercise-tab.tsx`,
  `documents-tab.tsx`, `livery-tab.tsx`, `pending-approval-card.tsx`,
  `app/(dashboard)/horses/[horseId]/page.tsx`,
  `app/(dashboard)/horses/new/page.tsx`,
  `app/api/v1/horses/route.ts` and 12 sub-routes
- **P0:** None.
- **P1:**
  - The profile has tabs `Overview / Livery / Health / Feeding / Exercise /
Documents / Notes`. **Medications** is not a top-level tab; it lives
    inside `health-tab.tsx` (verified at line ~483). This is a UX choice but
    breaks discoverability — the product plan and DATABASE.md list
    medications as a top-level feature. Consider promoting it to its own tab.
- **P2:**
  - Ownership-pending flow is wired: admin sees a badge in the sidebar
    (`pending` count), `pending` tab on the horses list, and `PendingApprovalCard`
    has approve / decline mutations. Confirmed loading / error / empty all
    handled.
  - Archive uses soft delete (`deleted_at`); restore is not in the UI.

### 6. Riders

- **Status:** Works
- **Files traced:** `components/riders/riders-list.tsx`,
  `rider-profile.tsx`, `app/api/v1/riders/route.ts` (+ `[riderId]/route.ts`)
- **P0:** None.
- **P1:** None.
- **P2:**
  - Medical-notes field is plain text (free-text, rendered as text per
    CLAUDE.md policy 2026-05-13). No richtext intentionally. Confirmed no
    `dangerouslySetInnerHTML` usage.
  - No "send email to this rider" CTA from the rider profile — the Emails
    page composer is decoupled.

### 7. Staff

- **Status:** Works
- **Files traced:** `components/staff/staff-list.tsx`,
  `app/api/v1/staff/route.ts` (+ `[memberId]/route.ts`)
- **P0:** None.
- **P1:** None.
- **P2:**
  - Add Staff currently just creates a `club_members` row with a Clerk userId
    (manual). There is no "invite by email" flow that emails a magic link.
    Acceptable for MVP but expected at scale.

### 8. Owners

- **Status:** Works
- **Files traced:** `components/owners/owners-list.tsx`,
  `app/api/v1/owners/route.ts` (+ `[memberId]/route.ts`)
- **P0:** None.
- **P1:** None.
- **P2:**
  - Same "no invite email" gap as Staff.

### 9. Finances

- **Status:** Works
- **Files traced:** `components/finances/finances-page.tsx` (1284 lines),
  `app/api/v1/finances/{payments,invoices,expenses,coupons,overview}/route.ts`
- **P0:** None.
- **P1:**
  - **Coupon currency**. AddCouponDialog does not surface a per-coupon
    currency field. `formatMoney(c.discountValue, currency)` uses the club
    default. For clubs that operate in multiple currencies (per-currency
    Finance Overview already supports this since audit pass-3), a fixed-amount
    coupon's effective value is ambiguous. Coupons table has no `currency`
    column either (migration 0055 added the column per memory but it's not
    surfaced in the UI). P1 because it's a payment-correctness ambiguity.
- **P2:**
  - Expenses, payments, invoices all paginated. All four tabs (Overview,
    Invoices, Payments, Expenses, Coupons) handle loading / error / empty.
  - Refund flow lives on the booking row, not Finances — fine.

### 10. Emails

- **Status:** Partially broken
- **Files traced:** `components/emails/emails-page.tsx` (147 lines),
  `audiences-tab.tsx` (520 lines), `app/api/v1/emails/audiences/route.ts`,
  `app/api/v1/emails/audiences/preview/route.ts`,
  `app/api/v1/emails/send/route.ts`
- **P0:**
  - **Compose cannot use Audiences.** Compose tab is a single `to:` email
    address field. No audience selector, no "send to N riders" affordance,
    no batch send. The Audiences tab can create / preview / count segments but
    they cannot drive a send. This is the most prominent decorative feature
    on the dashboard.
- **P1:**
  - No template gallery. The product plan + ARCHITECTURE.md list a templated
    email composer (booking reminders, payment receipts, etc.) but the
    composer is a free-text textarea. Templates ARE used by the system
    automatically (`packages/email-templates`), but admins can't preview or
    customize them from the UI.
  - No send history. The `webhook_events` table tracks Resend events
    (delivered / bounced / complained / failed / delayed) but the UI has no
    surface for it. Pass-7 closeout note ⑤ (memory: audit-pass-7) wired the
    suppression list to the DB and the `sendEmail` call, but the UI has no
    suppression-list view either.
- **P2:**
  - Compose form is RHF + Zod, with proper inline errors — good.
  - No bcc / cc fields, no scheduled-send, no attachments.

### 11. Competitions

- **Status:** Works
- **Files traced:** `components/competitions/competitions-list.tsx`,
  `competition-form.tsx`, `competition-detail.tsx`,
  `app/api/v1/competitions/route.ts` and 6 nested routes (classes,
  entries, results)
- **P0:** None.
- **P1:** None.
- **P2:**
  - Competition results visible in detail page; no public competition page
    on `/c/[slug]` — only the club profile. A rider browsing a stable can't
    see upcoming competitions from the public profile.

### 12. Arenas

- **Status:** Works
- **Files traced:** `components/arenas/arenas-list.tsx`,
  `app/api/v1/arenas/route.ts` (+ `[arenaId]/route.ts`)
- **P0:** None. **P1:** None. **P2:**
  - Bare CRUD list, no media. Functional. Probably the most minimal feature.

### 13. Reports

- **Status:** Partially broken
- **Files traced:** `components/reports/reports-page.tsx`,
  `app/api/v1/reports/route.ts`
- **P0:** None.
- **P1:**
  - **Single-currency assumption**. The Revenue summary card uses
    `formatMoney(totalRevenue, currency)` with the club's default currency,
    regardless of whether the underlying bookings span multiple currencies.
    Finance Overview already solved this with per-currency totals (audit
    pass-3, 2026-05-09); Reports has not been brought into line. For a
    mono-currency club this is invisible; for a club with bookings in AED
    and SAR it under/over-reports revenue.
  - "Revenue by Day" rows similarly assume one currency.
- **P2:**
  - Date range default is last 30 days. No CSV / PDF export.
  - All four queries handle error / empty.

### 14. Community

- **Status:** Stub
- **Files traced:** `app/(dashboard)/community/page.tsx` (34 lines),
  `app/rider/community/page.tsx` (28 lines)
- **P0:**
  - Renders only a "Coming soon" card on both surfaces. The mobile app has the
    same stub. The DB has `community_votes`, `discussion_topics`, etc. tables
    per audit memory but no UI surface drives them. Three of 29 surveyed
    feature areas are this stub.
- **P1:** None (gap covered above).
- **P2:** None.

### 15. Settings

- **Status:** Works
- **Files traced:** `components/settings/settings-page.tsx` (~300 lines+),
  `branding-form.tsx`, `discovery-form.tsx`, `notifications-form.tsx`,
  `permissions-matrix.tsx`, `subscription-panel.tsx`,
  `app/api/v1/settings/route.ts`,
  `app/(dashboard)/settings/payments/page.tsx`
- **P0:** None.
- **P1:**
  - PermissionsMatrix is read-only — clubs cannot customise the role →
    permission mapping. Acceptable for MVP, but `CLAUDE.md`'s permissions
    block implies it should be editable.
- **P2:**
  - 8 tabs (Profile, Booking Rules, Discovery, Notifications, Permissions,
    Payment, Subscription, Branding). Subscription tab is wired to the
    Ziina manual-pay-link platform-billing flow (Round 6, 2026-05-04 pivot).
  - DiscoveryForm includes the public-listing toggle the audit pass-7
    LOW-5 fix added; verified.

### 16. Public pages (`/`, `/discover`, `/c/[slug]`, `/legal`, `/help`, `/support`, `/status`)

- **Status:** Partially broken
- **Files traced:** `app/discover/{page,discover-client}.tsx`,
  `app/c/[slug]/{page,club-profile-client}.tsx`,
  `app/(legal)/{layout,help,legal,status,support}/...`,
  `components/shared/public-header.tsx`, `site-footer.tsx`,
  `app/not-found.tsx`,
  `app/layout.tsx`
- **P0:**
  - **No root `/page.tsx`.** Files in `app/` at root level are: `layout.tsx`,
    `globals.css`, `global-error.tsx`, `not-found.tsx`, and the favicon
    images — that's it. Yet PublicHeader and SiteFooter ship `href="/"`
    links everywhere, the rider layout's comment claims "the public
    marketing page took over the root URL", the not-found page has a "Go
    home" CTA to `/`, the mobile profile screen `openLegal('')` would target
    `https://cavaliq.com/`. Every one of these resolves to the
    Cavaliq-branded 404 page. The sign-in redirect target (`/dashboard` or
    `/rider`) saves authenticated users, but the unauthenticated public
    landing page is missing.
- **P1:**
  - `/status` is hardcoded to "All systems operational" with `new Date()` as
    the last-checked stamp on every render. Acceptable until the SLA monitor
    ships, but misleading during a real incident.
- **P2:**
  - `/discover` (revalidate=60), `/c/[slug]` (revalidate=60),
    `/legal/**` (static), `/help/**` (static with role-specific pages),
    `/support` (RHF + Zod intake form), `/legal/privacy/request` (intake) —
    all functional and well-built.

### 17. Rider home (`/rider`)

- **Status:** Works
- **Files traced:** `app/rider/page.tsx`, `rider-home.tsx`,
  `app/rider/layout.tsx`, `components/rider/rider-nav.tsx`
- **P0:** None.
- **P1:**
  - `RiderNav` exposes: Home, Book, Bookings, Stables, Horses, Progress,
    Profile. It does **not** link Invoices or Community. Invoices is only
    reachable from `/rider/horses` (a "Receipt" button on each owned-horse
    card). Community at `/rider/community` is fully orphan-routed —
    nothing in the nav points there. Both should at minimum have nav entries.
- **P2:**
  - Empty-state CTA on no-club is clean (Browse stables / Run your own).
  - The `bookingBadge` helper folds payment state into the badge so a
    rider seeing "confirmed/pending payment" understands they need to act.
    Good detail (2026-05-16).

### 18. Rider book (`/rider/book`)

- **Status:** Works
- **Files traced:** `app/rider/book/page.tsx` (~600 lines),
  `components/payments/pay-booking-dialog.tsx`,
  `app/api/v1/booking-slots/route.ts`,
  `app/api/v1/coupons/validate/route.ts`,
  `app/api/v1/bookings/route.ts`,
  `app/api/v1/bookings/[bookingId]/payment/route.ts`
- **P0:** None.
- **P1:** None.
- **P2:**
  - Guest booking on the same slot is supported (the rider books a guest with
    name/email/phone/skill).
  - Coupon validation is debounced and surfaces inline errors.
  - PayBookingDialog supports inline Stripe Elements + redirect (N-Genius /
    Ziina) and falls back to a "/rider" landing if the rider closes without
    paying.

### 19. Rider bookings (`/rider/bookings`)

- **Status:** Works
- **Files traced:** `app/rider/bookings/page.tsx`,
  `app/rider/bookings/[bookingId]/booking-detail-client.tsx`
- **P0:** None.
- **P1:** None.
- **P2:**
  - Three tabs (Upcoming / Recent / Agenda) feed from one paginated query
    capped at pageSize=50. A rider with >50 historical bookings would not
    see them all; pagination not surfaced.
  - Booking detail polls every 5s for up to 2 minutes while
    `paymentStatus==='pending'` — good handling of the webhook race.

### 20. Rider horses (`/rider/horses`)

- **Status:** Works
- **Files traced:** `app/rider/horses/page.tsx`, `new/page.tsx`,
  `app/api/v1/me/horses/route.ts`,
  `app/api/v1/horses/register-ownership/route.ts`,
  `app/api/v1/me/horses/[horseId]/retire/route.ts`
- **P0:** None.
- **P1:**
  - Retired horses cannot be reactivated from the rider UI — they have to
    DM the stable. Stated in the dialog copy but no in-app affordance.
- **P2:**
  - Four buckets (Pending / Active / Declined / Retired) rendered with
    StatusBadge + per-row CTAs. Cleanly built.

### 21. Rider progress (`/rider/progress`)

- **Status:** Works
- **Files traced:** `app/rider/progress/page.tsx`,
  `app/api/v1/me/profile/route.ts`
- **P0:** None.
- **P1:** None.
- **P2:**
  - "This Month" stat uses browser-local timezone (rider's watch) rather than
    club timezone (rider can't fetch club settings, intentional comment at
    line ~177).
  - No skill-level progression UI ("how to advance to intermediate").
  - No coach-feedback log on a per-booking basis. Booking-level notes table
    exists in DB but isn't surfaced here.

### 22. Rider invoices (`/rider/invoices`)

- **Status:** Works
- **Files traced:** `app/rider/invoices/page.tsx`,
  `app/api/v1/me/livery-invoices/route.ts`
- **P0:** None.
- **P1:**
  - **Livery only — no booking invoices.** The page title says "Livery
    invoices" and only renders rows from `getLiveryInvoicesOwnedByUser`.
    The `invoices` table holds booking invoices too, but the rider
    Profile / Bookings views never surface them. A rider who paid a lesson
    online sees no invoice ledger.
- **P2:**
  - "Pay now" button uses `safeHref(invoice.payLink)`, with a fallback line
    when the pay link hasn't been generated yet ("Pay link coming from
    {club}"). Good.

### 23. Rider community (`/rider/community`)

- **Status:** Stub — see #14.
- Page is a "Coming soon" card. Not linked from RiderNav.

### 24. Rider profile (`/rider/profile`)

- **Status:** Works
- **Files traced:** `app/rider/profile/page.tsx`,
  `app/api/v1/me/profile/route.ts`
- **P0:** None.
- **P1:** None.
- **P2:**
  - Editor handles all four states (loading / error / no profile yet /
    success).
  - Emergency contact and medical-notes fields are stored encrypted at rest
    (per CLAUDE.md / DATABASE.md) and rendered as plain text on read.
  - Account-side fields (email, password) are managed via Clerk's
    `<UserButton>` modal. Good.

### 25. Mobile (`apps/mobile/`)

- **Status:** Partially broken
- **Files traced:** all 7 tabs + auth screens + `(modals)`,
  `delete-account.tsx`, `about.tsx`, `booking/[bookingId]/...`
- **P0:**
  - **Horses tab calls the wrong endpoint.** See top-of-report finding #3:
    `apps/mobile/hooks/use-horses.ts:34` calls
    `GET /api/v1/horses` (gated by `horses:read`). Riders have
    `horses:read_own` only, so every rider opening the Horses tab gets a 403. The fix is one line — call `/api/v1/me/horses` instead, matching
    the web `/rider/horses` page.
- **P1:**
  - Community tab is a "Coming soon" card. (See #14.)
  - Mobile Profile screen's "About / Help / Status / Refunds" rows all open
    `https://cavaliq.com{path}` via `expo-web-browser`. `/legal/refunds` and
    `/help` both exist. `/legal/terms/end-user` exists. None of these is
    broken, but `LEGAL_BASE_URL` constant is hardcoded to `cavaliq.com` —
    a dev build pointed at staging would still open production legal pages.
    Documented in the source comment.
- **P2:**
  - Mobile bookings uses pageSize=20 on first load — verified at
    `apps/mobile/hooks/use-bookings.ts`. Pagination not surfaced.
  - Mobile delete-account flow exists and calls `/api/v1/account/delete`.
  - Toast notifications via `react-native-toast-message` (added pass-5 r5).
  - No mobile competitions / community / reports screens — by design for
    a rider-only app.

### 26. Webhooks

- **Status:** Works
- **Files traced:** all 7 webhook handlers
  (`stripe/[clubId]`, `ziina/[clubId]`, `ziina-platform`, `n-genius`,
  `clerk`, `resend`)
- **P0:** None.
- **P1:** None.
- **P2:**
  - All webhooks: signature verify → claim row → idempotent process → mark
    processed/failed; rate-limited by IP via Upstash (default 60/min).
    Body-cap enforced via `readWebhookBody`. Wrapped in top-level
    try/catch returning sanitized 500.
  - Resend webhook (added 2026-05-25) updates `email_suppression` and
    `sendEmail` checks the list before send (audit pass-7 ⑤).
  - Clerk webhook handles `organization.created`, `organizationMembership.*`,
    and `user.deleted` (pass-7 ⑥, PR #185).

### 27. Cron jobs

- **Status:** Works
- **Files traced:** 7 cron routes under `app/api/cron/`,
  `worker-entry.mjs`
- **P0:** None.
- **P1:** None.
- **P2:**
  - `livery-billing`, `platform-billing`, `booking-reminders`,
    `horse-care-reminders`, `audit-prune`, `booking-payment-timeout` (every
    10 min, sweeps abandoned PayPage bookings — 2026-05-16),
    `self-check` (cold-start env-binding probe — F-43 fix).
  - All are gated by `x-cron-secret` (`requireCronSecret`), all listed in
    `middleware.ts` public route list. The pass-6 HIGH (cron silently dead
    6d) was the missing `booking-payment-timeout` entry — closed.
  - `worker-entry.mjs` threads through `ctx.waitUntil` on Upstash result
    (pass-7 ② follow-up, PR #188) and wires `@sentry/cloudflare` so cron
    failures page out (pass-7 ③).

### 28. Email triggers

- **Status:** Works
- **Files traced:** `lib/email.ts`, `packages/email-templates/`, multiple
  callsites across booking / livery / platform-billing / horse-care crons
- **P0:** None.
- **P1:** None.
- **P2:**
  - Templates: booking-confirmation, booking-cancellation, booking-reminder,
    payment-receipt, horse-care reminders (vaccination / farrier / dental /
    insurance / medication-end), platform-overdue (7d / 14d / 30d),
    trial-ending (3d / 1d). All present in `packages/email-templates/`.
  - `sendTriggeredEmail` honours `email_suppression` (pass-7 ⑤). Honours
    per-rider `notification_preferences` rows.

### 29. Permissions / role-based access

- **Status:** Works
- **Files traced:** `lib/permissions.ts` (server-only),
  `lib/permissions-shared.ts`, `components/dashboard/sidebar.tsx`,
  every route's `withAuth({ requiredPermission })`
- **P0:** None.
- **P1:** None.
- **P2:**
  - 8 roles: club_admin / club_manager / coach / horse_owner / rider /
    parent / groom / veterinarian. Sidebar filters nav by `NAV_BY_ROLE`,
    server enforces via `withAuth({requiredPermission})` on every API
    route. PermissionsMatrix tab on Settings is read-only — not editable
    per club. Confirmed all v1 routes have permission guards.
  - Dashboard layout role-gate (`DASHBOARD_ROLES`) bounces rider/parent to
    `/rider`; rider layout reverse-bounces admins to `/dashboard`. Loop
    prevention via the role check up front.

---

## Recommended fix order

1. **(P0) Build `/page.tsx`** at `apps/web/app/page.tsx` — a static
   landing page describing the product, linking to /discover (riders),
   /sign-up?as=stable (stable owners), and /help. This unblocks every
   public `href="/"` link in PublicHeader, SiteFooter, not-found page,
   mobile in-app browser links, and the rider/discover header.
2. **(P0) Fix mobile Horses endpoint.** Change
   `apps/mobile/hooks/use-horses.ts` from `/api/v1/horses` →
   `/api/v1/me/horses`. Update the response unwrap from `getPaginated`
   to `get<MyHorsesResponse>` (the rider-scoped route returns
   `{horses, memberships}`, not a paginated horse list). Adjust the
   Horses tab UI to render the rider-scoped shape (or build a
   `/api/v1/me/horses/list` endpoint that returns the
   `PaginatedApiResponse<HorseListItem>` shape).
3. **(P0) Wire Audiences into Compose.** Either (a) add an audience
   selector + batch-send to `/api/v1/emails/send` (or a new
   `/api/v1/emails/broadcast`), or (b) hide the Audiences tab until the
   broadcast feature ships. Today, audiences exist solely as decoration.
4. **(P0) Ship a minimum Community surface or remove the navigation
   entries.** Three "Coming soon" cards across web admin, web rider, and
   mobile create a credibility gap when a prospect demos the product.
   Either remove the routes from the sidebar / tab bar, or land a
   v1 (e.g., a single threaded discussion list per club).
5. **(P1) Add Invoices + Community links to RiderNav.** Today
   `/rider/community` is unreachable from any in-app nav and
   `/rider/invoices` is only reachable from `/rider/horses`. One nav-config
   edit.
6. **(P1) Convert Reports revenue cards to per-currency** to match the
   Finance Overview that audit pass-3 shipped.
7. **(P1) Surface booking invoices on `/rider/invoices`** and rename the
   page from "Livery invoices" to "Invoices" (or split into two sections).
8. **(P1) Add a per-coupon currency** on the Add Coupon dialog (and
   `coupons.currency` schema column if it isn't already populated). The
   coupon discount value's currency is currently ambiguous for
   multi-currency clubs.
9. **(P1) Add a Medications tab on the horse profile** (currently nested
   inside Health) — matches product plan terminology.
10. **(P1) Add an email send-history / suppression-list view** in the
    Emails page so admins can see which sends bounced and which addresses
    are suppressed (data already exists in `webhook_events` and
    `email_suppression`).
11. **(P1) Build a templated-email composer** (gallery of system templates
    with previews + ability to override per club).
12. **(P1) Add "Promote / send to a rider" CTA** from the rider / owner /
    booking detail pages — links to a pre-filled compose form.

---

## Out of scope / known gaps

- I did not exhaustively trace every API route's tenant-scoping. I sampled
  ~12 of 91 v1 routes and all use `withAuth(ctx)` + `ctx.clubId` filtering
  in the query layer; no leaks were found in the sample. Audit passes 1–7
  closed every reported leak (per memory files). The remaining 79 routes
  are not flagged but were not individually re-verified.
- I did not test the actual payment provider flows live (Stripe Elements,
  N-Genius PayPage, Ziina link). I traced the code paths and webhook
  handlers and found the lifecycle (creation → webhook → reconcile →
  timeout-sweep) coherently wired, including the
  `booking-payment-timeout` cron's safety check that calls
  `adapter.getPaymentStatus` before auto-cancelling.
- I did not run the mobile app on a device or simulator. Bugs that would
  only show up at runtime (e.g., MMKV / SecureStore / Sentry init order)
  were not caught here — only static-code-traceable bugs were.
- I did not deeply audit the onboarding wizard's step-3 (Payments) or
  step-4 (Staff) sub-flows — sampled them and they're RHF + Zod with
  toasts but I did not trace every Stripe/Ziina/N-Genius connect endpoint
  return path.
- Help pages (`/help/{owner,rider,parent,coach,club-admin,groom}`) were
  not individually read; their existence is verified.
- The `/legal/**` tree was sampled, not exhaustively read.
- I did not verify mobile React Native iOS vs Android keyboard / safe-area
  / pull-to-refresh behaviour beyond reading the layout file.
- `lib/billing/*`, `lib/payments/n-genius.ts`, `lib/payments/ziina.ts`
  were not traced in depth — they're touched by the booking-payment flow
  and the cron sweep, but their internal correctness is out of scope for
  a feature-walkthrough.
