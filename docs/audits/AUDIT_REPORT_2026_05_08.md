# Comprehensive Code Audit — Cavaliq Monorepo

**Commit audited:** `e73dc7262e56b55d3fd830198936793c1999877c`
**Audit date:** 2026-05-08
**Scope:** Defense-in-depth audit of `apps/web` (Next.js 15 App Router on Cloudflare Workers via OpenNext, 96 API routes), `apps/mobile` (Expo / React Native), `packages/db` (Drizzle on Neon Postgres, 17 schema files, 47 migrations), `packages/shared` (Zod schemas + types + validators), `packages/api-client`, `packages/email-templates`, plus `wrangler.jsonc`, `open-next.config.ts`, GH workflows, cron handlers, webhook handlers, and payment adapters. Six parallel category-cluster passes covering A–N from the audit spec; this report consolidates them into severity order with global F-N numbering.

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 5     |
| MED      | 14    |
| LOW      | 36    |
| NIT      | 21    |

No CRITICAL findings — no exploitable cross-tenant leaks, no payment double-charge, no webhook bypass, no plaintext secrets, no raw card-data handling. Five rounds of prior audit (visible in code comments tagged `audit F-N (2026-05-…)`) have closed every serious correctness bug; the residual surface is defense-in-depth gaps, two PHI encryption gaps that mirror the rider-medical-notes pattern, one structural type-safety debt around response DTOs, and one performance hot spot on the audiences-list endpoint.

The five HIGH findings cluster into three themes: (1) PHI encryption coverage incomplete on `horse_medication_logs` and `horse_feeding_plans`/`horse_exercise_schedules` notes columns (F-2, F-3); (2) response DTO types redeclared per-consumer instead of shared (F-4); (3) one runtime 500 caused by a Zod-vs-pgEnum drift (F-1) and one unbounded tenant-table read on the audiences endpoint (F-5).

---

## Findings

### F-1 — Coupon list filter `status` enum drifted from DB pgEnum [HIGH]

**Where:** `apps/web/app/api/v1/finances/coupons/route.ts:37-41`, `packages/db/src/schema/enums.ts:63-68`, `packages/db/src/queries/finances.ts:279`

**Finding:** The list filter accepts `z.enum(['active', 'inactive', 'expired'])` but the DB column `coupons.status` is the pgEnum `coupon_status` with values `('active','paused','expired','exhausted')`. Two concrete failures: (a) `?status=paused` (a legitimate operator-set state — `updateCouponSchema` at `apps/web/app/api/v1/finances/coupons/[couponId]/route.ts:49` accepts it) is rejected at validation with a 400, so the UI cannot list paused coupons. (b) `?status=inactive` passes validation, then the query runs `sql\`${coupons.status} = ${filters.status}\``against the enum column. Postgres errors`invalid input value for enum coupon_status: "inactive"` and the route returns a 500.

**Why it matters:** UI filter dropdown is wired to a contract the DB enforces against. A stale enum literal here means the filter is functionally broken AND produces user-visible 500s — the worst combination (broken AND noisy).

**Recommendation:** Replace with `z.enum(['active', 'paused', 'expired', 'exhausted']).optional()`, ideally importing the literal tuple from the pgEnum. Add a Vitest case round-tripping every enum value through the filter. Audit the same pattern in `documents`/`members` GET filters (covered as F-13).

---

### F-2 — `horse_medication_logs.notes` and `.skip_reason` stored plaintext despite being PHI [HIGH]

**Where:** `packages/db/src/schema/horse-health.ts:127-128`, `packages/db/src/queries/horse-health.ts:55,340-347`

**Finding:** Schema:

```ts
skipReason: text('skip_reason'),
notes: text('notes'),
```

`createMedicationLog` calls `db.insert(horseMedicationLogs).values({ ...data, clubId, horseId })` with no `encryptFields` wrap. `MEDICATION_ENCRYPTED_FIELDS` (line 55) covers only `horseMedications.notes` — NOT the logs. The PHI key list (`packages/shared/src/constants/index.ts:112`) names `notes` as PHI, and the logger redacts it in stdout, but the column itself is plaintext on disk.

**Why it matters:** Medication-log rows are the audit trail of what was administered, when, and why a dose was skipped. `skip_reason` ("rider rejected — abscess flared") and `notes` are clinical PHI. A Neon backup leak or a Drizzle Studio session by an operator surfaces medical content the rest of the codebase treats as encrypted. The logger's redaction is irrelevant if the column itself is plaintext at rest.

**Recommendation:** Add `MEDICATION_LOG_ENCRYPTED_FIELDS = ['notes', 'skipReason'] as const`, wrap insert + decrypt-on-read for `getMedicationLogs` and `createMedicationLog`. Backfill existing rows with a one-shot script (mirror `scripts/backfill-rider-medical-notes.mjs`). Add a verifier migration that aborts when any post-cutoff row lacks the `v1:` prefix.

---

### F-3 — `horse_feeding_plans.notes` and `horse_exercise_schedules.notes` plaintext despite vet-prescribed content [HIGH]

**Where:** `packages/db/src/schema/horse-health.ts:162` (feeding), `:209` (exercise); `packages/db/src/queries/horse-health.ts:402-406`

**Finding:** Same shape as F-2. The feeding-plan `notes` field carries vet/groom-prescribed content like "low-protein due to laminitis recovery." `horse_exercise_schedules.notes` carries similar prescriptive content. Neither is wrapped through `encryptField` on insert/update; `createFeedingPlan` and the exercise-schedule writers pass the raw value straight through to Drizzle.

**Why it matters:** A horse's chronic condition is reconstructible from feeding-plan notes even when the corresponding `horse_health_records.diagnosis` is encrypted. Defense-in-depth gap that defeats the encryption invariant the rest of the schema observes.

**Recommendation:** Add `FEEDING_PLAN_ENCRYPTED_FIELDS = ['notes']` and `EXERCISE_SCHEDULE_ENCRYPTED_FIELDS = ['notes']`. Same backfill-and-verifier-migration pattern as F-2. Bundle F-2 + F-3 into a single migration + script pair since the schema deltas are mechanical.

---

### F-4 — Per-route response DTOs redeclared in every consumer instead of shared [HIGH]

**Where:** `packages/api-client/src/endpoints/index.ts:1-2` (empty `export {};` stub); duplicated row shapes at `apps/web/hooks/use-horses.ts:13-92`, `apps/mobile/hooks/use-horses.ts:4-20`, `apps/web/hooks/use-bookings.ts:36-90`, `apps/mobile/hooks/use-bookings.ts:6-28`, `apps/web/hooks/use-finances.ts:24-80`, `apps/web/hooks/use-horse-health.ts:24-90`, `apps/web/hooks/use-competitions.ts:17-72`, `apps/web/hooks/use-staff.ts`, `apps/web/hooks/use-riders.ts:8`, `apps/web/hooks/use-payment-accounts.ts:10`, `apps/web/hooks/use-subscription.ts:11-40`, `apps/web/hooks/use-settings.ts:14-70`, `apps/web/hooks/use-dashboard.ts:8`.

**Finding:** `packages/shared/src/types/index.ts` exports the envelope (`ApiResponse<T>`, `PaginatedResponse<T>`) and runtime enum literals — but every per-route DTO (`Horse`, `HorseListItem`, `Booking`, `BookingSlot`, `Coupon`, `Invoice`, `MedicationLog`, `Rider`, `Competition`, `CompetitionClass`, `CompetitionEntry`, `ClubSettings`, `Payment`, `Expense`, `FeedingPlan`, `ExerciseSchedule`) is re-declared inside `apps/web/hooks/*` AND again in `apps/mobile/hooks/*`. The web `Horse` shape (line 35-92) declares `status: 'available' | 'resting' | 'injured' | 'retired' | 'off_site' | 'sold'` (precise union); the mobile `Horse` shape (line 12-13) declares `status: string` and `skillLevel: string` — same wire field, two different consumer types, no compile-time guard that they stay in sync. `packages/api-client/src/endpoints/index.ts` is a stub.

**Why it matters:** Violates the audit-spec invariant directly ("Every API response shape exported from `packages/shared` and consumed by `packages/api-client`"). The route handler's DB projection (`getHorsesByClub` ~18 cols, `getCompetitionEntries` 9, `getRidersByClub` 14 + decrypted `medicalNotes`) is the single source of truth — but consumer types are hand-typed copies. Drift is silent: a column added to `getHorsesByClub` is observed by web's manual update, mobile keeps `status: string`, and the next person who narrows on `horse.status === 'sold'` in mobile gets `false` because the comparison is against a wider type. When a route widens an enum (e.g., adds `'on_loan'`), neither hook knows; switch-statements silently fall through. The derived-type pattern (`packages/db/src/queries/horses.ts:393-395` exports `HorseAvailableForMatching = Awaited<ReturnType<typeof getAvailableHorsesForMatching>>[number]`) exists inside `packages/db` but isn't surfaced through `packages/shared` or `packages/api-client` — none of those derived types are re-exported.

**Recommendation:** Move every `export interface Horse | Booking | Rider | …` declaration out of `apps/web/hooks/*` and `apps/mobile/hooks/*` into `packages/shared/src/types/responses/` (one file per resource). Where the row matches an existing `*ListItem` derived from the query projection, re-export the derived type from `packages/db/src/queries/*` through `packages/shared`. Wire `packages/api-client/src/endpoints/index.ts` to expose `apiClient.horses.list(filters): Promise<PaginatedApiResponse<HorseListItem>>` so web + mobile both narrow against the same union. Companion task: add per-route Zod runtime validation (currently `parseEnvelope<T>` casts `data as T` with no per-route schema — see also F-46/F-47).

---

### F-5 — `countAudienceMembersBatch` loads ALL active riders into memory per audiences-list GET [HIGH]

**Where:** `packages/db/src/queries/audiences.ts:271-293`, consumer `apps/web/app/api/v1/emails/audiences/route.ts:46-57`

**Finding:**

```ts
const rows = await db
  .select({ memberId: …, skillLevel: …, totalBookings: sql<number>`coalesce(${bookingAgg.totalBookings}, 0)`, lastBookingAt: bookingAgg.lastBookingAt })
  .from(clubMembers)
  .leftJoin(riderProfiles, …)
  .leftJoin(bookingAgg, …)
  .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.role, 'rider'), eq(clubMembers.isActive, true)));

return filterSets.map((filters) => { /* in-memory scan over rows */ });
```

No `.limit()`. Pulled across every active rider in the tenant on every audience-list GET (the route paginates audiences themselves but invokes this batch fn over all per-page audience filter sets). Docblock at line 245 says "We pull every eligible rider plus the attributes the filters reference once" — explicitly unbounded by design.

**Why it matters:** Tenant-scoped, fully unbounded read on `clubMembers + riderProfiles + bookings` aggregate. JSR's seed dataset is small but the model is "hundreds of clubs, thousands of riders each." A 5,000-rider club loads 5,000 rows per refetch; tab focus re-runs the GET. CPU + memory grow linearly; combined with the no-limit JOIN the query plan also degrades. Tenant-side DoS surface — a malicious admin can hammer their own audiences endpoint to exhaust the per-club connection budget. Per the rubric, "unbounded query on tenant table = HIGH."

**Recommendation:** Two paths:

1. Push the per-filter-set logic into SQL: emit one `count(*)` per filter set with WHERE predicates equivalent to the in-memory filters. For a paginated UI of 25 audiences, that's ≤25 sub-second `count(*)` queries — modern Postgres handles this in tens of milliseconds total.
2. Cap the in-memory load with a hard `.limit(MEMBERS_PREVIEW_CAP)` (already used in `resolveAudienceMembers:168`). Counts above the cap surface as `>${CAP}`. Trades exactness for guaranteed bound.

---

### F-6 — N-Genius webhook resolves outletId across ALL clubs without UNIQUE binding [MED]

**Where:** `apps/web/app/api/webhooks/n-genius/route.ts:115-143`, `packages/db/src/queries/payment-accounts.ts:731-748`

**Finding:** Single-URL receiver looks up the club from `payload.outletId` via `findWebhookConfigByExternalId(outletId, 'n_genius')`. The query has zero clubId binding, only `(externalAccountId, provider, status)`:

```ts
const account = await findWebhookConfigByExternalId(outletId, 'n_genius');
if (!account) {
  return new Response('Unknown outlet', { status: 401 });
}
event = await nGeniusAdapter.verifyWebhook({
  body,
  signatureHeader: provided,
  webhookSecret: headerValue,
});
```

No UNIQUE constraint enforces `(provider, external_account_id)` is single-tenant. Stripe's per-club webhook (`/api/webhooks/stripe/[clubId]`) and Ziina's per-club webhook (`/api/webhooks/ziina/[clubId]`) URL-bind clubId, making cross-tenant routing structurally impossible. N-Genius alone trusts a body-supplied identifier.

**Why it matters:** If two clubs ever share an outletId (operator error, a column-copying schema migration, or a future N-Genius rebrand collapsing outlet IDs), the lookup picks the first row by Drizzle default order and the webhook posts payments against the wrong club. The `wasProviderPaymentIssuedRecently` defense-in-depth check is documented at line 222 as fail-open.

**Recommendation:** Add a UNIQUE constraint on `(provider, external_account_id) WHERE provider = 'n_genius' AND status != 'disabled'` so the lookup is provably single-tenant. Alternatively, migrate N-Genius to per-club URLs once the provider portal supports it.

---

### F-7 — Filter query strings forward raw values into pgEnum columns, surfacing 500 instead of 400/422 [MED]

**Where:** `apps/web/app/api/v1/horses/[horseId]/documents/route.ts:21-23`, `apps/web/app/api/v1/members/route.ts:25-49`

**Finding:** `documents` GET reads `request.nextUrl.searchParams.get('category')` raw and passes through to `getDocuments(...)` which compares against `horse_documents.category` — a `file_category` pgEnum (`packages/db/src/schema/enums.ts:104-114`). `?category=anything` reaches the DB; Postgres rejects the bind as `invalid input value for enum file_category`; the route returns a 500. Same for `members/route.ts` when `?role=invalid_role` reaches `getMembersByRole` which calls `inArray(clubMembers.role, roles as ClubMemberRole[])` — the cast is nominal, Postgres still rejects at bind time.

**Why it matters:** Anything surfacing invalid input as a 500 (rather than 400/422 with a Zod payload) breaks Sentry signal-to-noise — operators chasing an "internal error" alert end up tracing it to a typo, and CI synthetic checks can't distinguish server bugs from user error.

**Recommendation:** Wrap each filter in a Zod parse against the actual enum literal tuple. For `documents`: `z.enum(FILE_CATEGORIES)`. For `members`: validate `role` against `userRoleEnum.enumValues` before forwarding. Same hardening for `recordType` filter on `apps/web/app/api/v1/horses/[horseId]/health/route.ts:23` (varchar — lower-impact but inconsistent with the canonical list in `createHealthRecordSchema`).

---

### F-8 — `documents` POST trusts upload-verify only client-side [MED]

**Where:** `apps/web/app/api/v1/horses/[horseId]/documents/route.ts:33-85` (POST), comment 54-58

**Finding:** Route comment says "The R2 file URL was already verified against ctx.clubId by /api/v1/upload/verify" — but the only enforcement of that call is in `apps/web/components/ui/file-upload.tsx:124` (the web client). A direct API caller can call `POST /api/v1/upload`, do the R2 PUT, skip `/api/v1/upload/verify`, and POST `{ fileUrl: "<bogus>", … }` to `documents`. The route inserts the row without re-checking magic bytes server-side.

**Why it matters:** Magic-byte verification was added to prevent mis-typed objects (an attacker uploads a script claiming `image/jpeg`, served from the club's CDN). Today the entire defense rests on client-side discipline. Mobile is not a current consumer but will be; any third-party API integration sidesteps it.

**Recommendation:** Move verification to a server-side gate — when `documents`, `horses.primaryPhotoUrl`, etc. receive a `fileUrl`, parse the R2 key from it and call `verifyObjectMagicBytes` inline as part of the persist path. Cache the verification (`verifiedAt` keyed by R2 key) so retries don't pay the byte-fetch cost twice. Until then, downgrade the comment to "best-effort, the client SHOULD call /api/v1/upload/verify."

---

### F-9 — TS schema does not mirror SQL-only booking partial-unique indexes + CHECK [MED]

**Where:** `packages/db/src/schema/bookings.ts:289-377` vs `packages/db/migrations/0015_booking_guest_fields.sql`

**Finding:** Migration 0015 adds three artifacts: a CHECK constraint (`bookings_guest_contact_required_check`) and two partial unique indexes preventing the same rider/guest from booking the same slot twice (`idx_bookings_unique_rider_slot`, `idx_bookings_unique_guest_slot`). None are declared in `packages/db/src/schema/bookings.ts`. `bookings_amount_nonneg` and `bookings_refund_le_amount_check` ARE declared via Drizzle's `check(...)` helper — so the omission is partial. Partial unique indexes are not first-class in Drizzle, but the absence is undocumented (unlike `idx_bookings_provider_payment` which IS called out at lines 236-243).

**Why it matters:** These indexes are the entire defense against booking-creation races — `createBooking` at `packages/db/src/queries/bookings.ts:521-674` relies on them plus the atomic `currentRiders + 1` UPDATE. If a future contributor regenerates the schema for a new table without realizing 0015's invariants are SQL-only, dedup fails open.

**Recommendation:** Declare the CHECK constraint via `check('bookings_guest_contact_required_check', sql\`...\`)`in table-extras (Drizzle supports it). For the two partial unique indexes, add a comment block at table-extras level documenting them as SQL-only artifacts of migration 0015 (mirror lines 236-243 for`idx_bookings_provider_payment`).

---

### F-10 — Refund adapter calls don't mark transient HTTP errors as retryable [MED]

**Where:** `apps/web/lib/payments/stripe.ts:356-362`, `apps/web/lib/payments/ziina.ts:200-206`, `apps/web/lib/payments/n-genius.ts:523-528`

**Finding:** All three refund paths construct `PaymentProviderError('REFUND_FAILED', …)` without a `retryable: true` flag for 5xx/429 outcomes. The booking-refund route (`apps/web/app/api/v1/bookings/[bookingId]/refund/route.ts:230-248`) wraps the adapter call in `withProviderRetry`, but `withProviderRetry` only retries when `err.retryable === true` (`apps/web/lib/payments/retry.ts:84-91`). Compare `n-genius.ts:368` — `createPayment` correctly flags `retryable: res.status >= 500 || res.status === 429`. Refund errors uniformly appear non-retryable, so a transient 502 from Stripe/Ziina/N-Genius during refund processing surfaces as 502 to the operator on attempt 1 with no retry.

**Why it matters:** The retry-helper-wrapping was meant to absorb exactly these errors but doesn't reach the catch site that throws. Combined with F-11 (refund idempotency key embeds `Date.now()`), the operator's manual "click again" recovery path is dangerous.

**Recommendation:** In all three refund methods, pass `{ retryable: res.status >= 500 || res.status === 429, cause: err }` to the `PaymentProviderError` constructor. For Stripe, classify `Stripe.errors.StripeConnectionError` and `StripeAPIError` (5xx) as retryable, mirroring `createPayment` at `stripe.ts:330`.

---

### F-11 — Refund idempotency key includes `Date.now()`, defeating Stripe's 24h replay window [MED]

**Where:** `apps/web/app/api/v1/bookings/[bookingId]/refund/route.ts:230-238`

**Finding:** Refund idempotency key is `refund_${bookingId}_${liveSoFar}_${finalAmount}_${Date.now()}`. The accompanying comment frames this as protection against admin-issues-then-reverses-then-re-issues. But `Date.now()` is stamped on the FIRST attempt of every refund — so if the route handler crashes between the provider call returning and `recordBookingRefund` committing (e.g. Worker eviction at the wall-clock boundary), the operator's retry mints a brand-new key and Stripe issues a SECOND real refund. The `FOR UPDATE` lock guards admin double-clicks but not crash-and-retry across separate Worker invocations.

**Why it matters:** Worst-case = double-refund on a Worker crash mid-refund, with no automatic reconciliation. The booking ledger only gets the second `recordBookingRefund` increment, so `refundedAmountMinor` looks correct while Stripe shows two refund entries. Manual reconciliation against Stripe Dashboard is the only way to detect.

**Recommendation:** Drop `Date.now()`. Use `refund_${bookingId}_${liveSoFar}_${finalAmount}` and accept that re-execution of the same `(liveSoFar, finalAmount)` tuple within 24h returns the same Stripe refund. The "reverse-and-redo" scenario the comment cites is correctly handled by Stripe's idempotency: the second `refunds.create` returns the original refund object; `recordBookingRefund` then runs the CAS based on current `refundedAmountMinor` (post-reversal back to 0), so the ledger advances correctly.

---

### F-12 — Per-club Stripe and Ziina webhook receivers have no rate limit [MED]

**Where:** `apps/web/app/api/webhooks/stripe/[clubId]/route.ts:62-110`, `apps/web/app/api/webhooks/ziina/[clubId]/route.ts:49-101`

**Finding:** N-Genius receiver has `failClosed` IP-keyed rate limit (line 86-94, audit F-4 closeout); platform-Ziina mirrors it (audit F-17). Per-club Stripe and Ziina do neither. They rely on `clubIdSchema = z.string().uuid()` to gate enumeration, but a fuzzer with a leaked clubId UUID (slugs are public on `/discover/clubs`, UUIDs leak via certain admin URLs) can drive arbitrary load through body-cap → DB-lookup → AES-GCM-decrypt → HMAC-compute pipeline. ~100µs HMAC work plus a credential decrypt per request, with nothing capping the rate.

**Why it matters:** Once a clubId is known, the route is a free DoS amplifier against the Worker's CPU budget. Lower severity than the public platform-Ziina case (clubIds are UUIDs not slugs), but the asymmetry is unintentional.

**Recommendation:** Mirror the n-genius/platform-Ziina pattern: `checkRateLimit(\`webhook:stripe:${ip}\`, { maxRequests: 60, windowMs: 60_000, failClosed: true })`early in`handlePost`. Stripe's documented retry cadence (5 attempts over ~3 days) sits comfortably under 60/min. Same for Ziina.

---

### F-13 — `applyLiveryInvoiceWebhook` doesn't surface paid-event-for-cancelled-invoice the way booking flow does [MED]

**Where:** `apps/web/lib/payments/webhook-helpers.ts:914`

**Finding:** Early-return for terminal invoice statuses is `invoice.status === 'paid' || invoice.status === 'cancelled'`. No equivalent of the booking flow's audit AI-24 guard ("a paid event for a cancelled booking surfaces as `permanently_failed`"). A rider who paid a livery invoice, then admin cancelled it, then the webhook arrives: invoice stays `cancelled`, rider's payment is stuck in the merchant balance with no automatic refund or operator alert. Booking flow signals `permanentFailureReason`; livery flow returns `matched` cleanly.

**Why it matters:** Symmetry gap with booking flow. Rider has paid; invoice is cancelled; nothing fires the alert.

**Recommendation:** When `invoice.status === 'cancelled'` AND event is `succeeded` AND `event.amountReceivedMinorUnits > 0`, return `{ kind: 'matched', invoiceId, clubId, permanentFailureReason: 'Payment received for a cancelled livery invoice — manual reconciliation required' }`. Update receiver routes to mark the dedup row `permanently_failed` on that signal.

---

### F-14 — `findHorsesDueForBilling` loads every billable horse across every club without `.limit()` [MED]

**Where:** `packages/db/src/queries/livery-invoices.ts:40-110`

**Finding:** Joins `horses → clubs → clubMembers` with no `.limit()`. Filters on `ownershipStatus='active'`, `liveryStartDate ≤ today`, `monthlyLiveryFeeMinor > 0`, soft-delete-null. Returned to the daily cron at `apps/web/app/api/cron/livery-billing/route.ts:288` which iterates and bills.

**Why it matters:** Cron-only path (not a tenant-API surface) so MED, not HIGH. At 50 clubs × 200 horses = 10K rows, with the join expanding to ~5KB/row, ~50MB allocated in Worker memory before the cron loop starts. The cron has 5min wallclock budget; memory pressure plus per-row sequential `findHorseBillingAnchor` round-trips already constrain throughput. `pruneAuditLog` already established the bounding pattern.

**Recommendation:** Add `.limit(1000)` (or operator-tunable). Cron fires daily; partial passes are inherently safe (next day's run continues), and `audit-log.ts:90` (`pruneAuditLog`) already established this pattern. Order by `liveryStartDate DESC` so newer horses (likelier to need this period's invoice) win when the limit binds.

---

### F-15 — Booking-reminders cron does coach lookup per booking instead of per club [MED]

**Where:** `apps/web/app/api/cron/booking-reminders/route.ts:87-244`, specifically lines 192-203

**Finding:** Cron iterates `candidates: BookingReminder[]` (capped at 500). Per candidate: one `getMemberByIdIncludingDeactivated` round-trip for coach name (when `coachMemberId` is set), one `markBookingReminderSent` UPDATE (CAS), one `sendTriggeredEmail`, on failure one `unmarkBookingReminderSent`. `getClubById` is correctly cached across iterations (lines 85-94). The coach lookup is not — and the coach is a small enumerated set per club (typically <10 coaches).

**Why it matters:** Cron-bound, MED. 500 candidates × one coach round-trip = 500 sequential DB fetches even when most resolve to the same dozen coaches. At 30ms/round-trip, ~15s of cron wallclock per pass — material against the 5min budget.

**Recommendation:** Add `coachCache: Map<string, ClubMemberRow | null>` keyed on `coachMemberId` next to `clubCache` (line 85). Alternatively, widen `findUpcomingBookingsForReminder` (`bookings.ts:1086`) with LEFT JOIN `clubMembers` for coach name in the same pass — eliminates the lookup entirely.

---

### F-16 — Mobile `book.tsx` `useBookingSlots` has no error state [MED]

**Where:** `apps/mobile/app/(tabs)/book.tsx:127,368-374`

**Finding:** `const { data: slotsData, isLoading } = useBookingSlots({ dateFrom, dateTo });` — destructures only `data` and `isLoading`. No `isError`, no `error`, no `refetch`. Browse tab renders loading skeleton, then "No slots available / Try a different date" if `slotsForDate.length === 0`. A network failure or 500 surfaces as an empty list with the wrong copy. Home and horses screens DO handle `errorMessage = data && !data.success ? data.error.message : null` — book.tsx is the lone holdout.

**Why it matters:** Critical user flow (booking creation) on the most-used mobile screen. Cellular connectivity on mobile is flakier than web; an error state with a retry button converts "the app's broken" support tickets into self-service recoveries.

**Recommendation:**

```tsx
const { data: slotsData, isLoading, refetch: refetchSlots } = useBookingSlots({ dateFrom, dateTo });
const slotsErrorMessage = slotsData && !slotsData.success ? slotsData.error.message : null;
```

Add a render branch with `Try again` button calling `refetchSlots()`. Mirror the home/horses patterns.

---

### F-17 — `env-check.ts` boot probe omits five production-required secrets [MED]

**Where:** `apps/web/lib/env-check.ts:19-54`

**Finding:** `PRODUCTION_REQUIRED_ENV_VARS` lists only `SENTRY_DSN`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, `EMAIL_FROM`, `CRON_SECRET`. Missing from the boot warn: `R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` (every signed upload + delete fails — `apps/web/lib/storage.ts:57`), `CLERK_SECRET_KEY` + `CLERK_WEBHOOK_SECRET` (auth + Clerk webhooks fail open).

**Why it matters:** Audit-spec invariant is "CI fails on missing." Current probe is a one-shot `logger.warn('env_misconfigured', …)` at boot — doesn't fail CI. It also omits half the production-required surface, so a deploy that forgets `R2_*` quietly degrades file uploads to 503s with no boot-time signal.

**Recommendation:** Extend the array to cover the R2 + Clerk pairs. Promote the structured warn to a hard exit when `NODE_ENV === 'production'` (matches `assertEncryptionKeyConfigured`'s throw policy in `packages/db/src/crypto.ts:33`). Track `.env.example` 1:1 with the boot probe.

---

### F-18 — `emails/send` route writes no `audit_log` row [MED]

**Where:** `apps/web/app/api/v1/emails/send/route.ts:113-138`

**Finding:** Successful send emits `logger.info('email_sent', { to, subject, … })` and returns. `to` and `subject` are scrubbed by the redactor, so the structured log records "email sent at T=now" but does not preserve recipient identity for later reconstruction. There is no `void ctx.audit({ action: 'email.send', resourceType: 'club_member', resourceId: <recipientMemberId> })` write.

**Why it matters:** Audit-spec requires "Audit trail covers who did what + when for every mutating action on tenant data." Sending email to a club member is mutating in the recipient's eyes. Without an audit row, an "I never asked for that email" support ticket is unanswerable from the database — operator must trust redacted Sentry/Logpush trail.

**Recommendation:** Look up recipient `clubMembers.id` (already queried at `apps/web/app/api/v1/emails/send/route.ts:35`), then `void ctx.audit({ action: 'email.send', resourceType: 'club_member', resourceId: recipient[0]!.id, changes: { subject: { from: null, to: data.subject } } })`. Subject is club-staff-authored, safe to record verbatim.

---

### F-19 — `auditLog.changes` JSONB has no schema-level guard against PHI keys [MED]

**Where:** `packages/db/src/schema/operations.ts:411-413`, `packages/db/src/queries/audit-log.ts:38`, callers like `apps/web/app/api/v1/horses/[horseId]/medications/[medicationId]/route.ts:39`

**Finding:** `auditLog.changes` is unstructured `Record<string, AuditLogChange>`. `createAuditEntry` doesn't filter the `changes` shape against a PHI denylist. There is no enforcement that callers don't accidentally pass `changes: { diagnosis: { from: 'old', to: 'new' } }` — which would write decrypted PHI to a non-encrypted column and bypass the logger redactor (Sentry forwarding goes via the logger, not the audit-log writer). Spot-checked 4 routes against PHI tables — none currently pass PHI keys, but there's no compiler or runtime guard.

**Why it matters:** Audit-spec requires "Encrypted fields not logged, not in audit trails, not in notification data payloads." Audit-log surface depends on caller discipline.

**Recommendation:** In `createAuditEntry`, scrub `params.changes` against `PHI_KEYS` before insert. Key match → replace value with `{ from: '[REDACTED]', to: '[REDACTED]' }` (or drop). Add a lint rule or pre-commit grep for `audit({` plus any PHI key.

---

### F-20 — `/api/v1/me/active-club` DELETE skips the same-origin/CSRF check that POST enforces [LOW]

**Where:** `apps/web/app/api/v1/me/active-club/route.ts:65-70` (POST has guard) vs `:134-153` (DELETE does not)

**Finding:** POST runs `if (!isSameOriginRequest(request)) return errorResponse('FORBIDDEN', 'Cross-origin request blocked', 403);`. DELETE skips entirely:

```ts
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return errorResponse('UNAUTHORIZED', 'Authentication required', 401);
  const response = successResponse({ cleared: true });
  response.cookies.set(ACTIVE_CLUB_COOKIE, '', { … });
  return response;
}
```

**Why it matters:** Cross-origin attacker tricks a signed-in rider into hitting this endpoint → cookie cleared → next `getTenantContext()` falls back to most-recently-joined → silently switches the rider's active stable. Not privilege escalation but UX-disrupting CSRF surface POST already defends against.

**Recommendation:** Mirror POST's `isSameOriginRequest(request)` check at the top of DELETE.

---

### F-21 — `/api/v1/horses/register-ownership` accepts `clubId` from request body [LOW]

**Where:** `apps/web/app/api/v1/horses/register-ownership/route.ts:23-46`, `packages/db/src/queries/horses.ts:452-510`

**Finding:** Route accepts `data.clubId` from the body and passes it to `registerHorseOwnership({ clubId: data.clubId, … })`. Violates "club context from session, not body" but is a deliberate multi-club-target exception. `registerHorseOwnership` re-validates: user MUST be active `club_members` row in `data.clubId` AND role at that club must be `rider`/`horse_owner`, otherwise throws `OWNERSHIP_ROLE_NOT_ALLOWED`. Verified safe today.

**Why it matters:** Single intentional break from the body-clubId rule, dependent on `registerHorseOwnership` keeping that re-check forever. A future contributor refactoring the query (e.g., to return early when role check passes) might drop the active-membership filter.

**Recommendation:** Add a code-comment block at the route top stating "TARGET-CLUB pattern: body.clubId is allowed here BECAUSE registerHorseOwnership re-validates membership at the target. Do NOT remove that check." Or wrap in a typed `new TargetClub(data.clubId)` so the type system makes the divergence from `ctx.clubId` explicit.

---

### F-22 — `bookings:read_own` riders can probe arbitrary `riderMemberId` filter values [LOW]

**Where:** `apps/web/app/api/v1/bookings/route.ts:53-83`

**Finding:** List endpoint validates rider can only filter on own id OR verified dependent's id. Otherwise returns 403. A rider can iterate `riderMemberId=<arbitrary UUID>` and distinguish "bookings exist but you can't see them" (403) from "no bookings" (200 + empty list). Within-tenant only — uuids aren't enumerable from outside.

**Why it matters:** Same-tenant only. Rate-limited at 60/min. Member uuids inside a club are not secret (appear in booking responses for shared slots). Defense-in-depth grade.

**Recommendation:** Return 200 + empty list for non-self / non-dependent filters instead of 403. Removes the 403-vs-200 information disclosure for free.

---

### F-23 — `/api/v1/health` deep probe lacks `failClosed` and is loosely capped [LOW]

**Where:** `apps/web/app/api/v1/health/route.ts:28-42`, `lib/redis.ts`

**Finding:** Public health endpoint, intentionally unauthenticated for the external monitor. `?deep=1` mode hits Postgres (`SELECT 1`) AND Upstash Redis (`PING`) on every request:

```ts
const rl = await checkRateLimit(`health:${ip}`, { maxRequests: 120, windowMs: 60_000 });
await rawDb.execute(sql`SELECT 1`);
await redis.ping();
```

`failClosed` is NOT set. Upstash outage drops throttle to per-isolate counters; a deep-probe spammer floods the Neon HTTP pool. 120/min/IP is high for a probe touching Postgres on every hit (other unauth DB-touching endpoints sit at 5-20/min/IP).

**Why it matters:** Tenant-isolation isn't directly affected, but the deep probe shares the Neon connection pool with every authenticated route. 1000 RPS attack from a single IP under an Upstash outage burns the pool and degrades all tenant traffic.

**Recommendation:** Add `failClosed: true`. Gate `?deep=1` behind a tighter cap (e.g., `maxRequests: 30` for `health:deep:${ip}`) while leaving cheap liveness mode at 120/min.

---

### F-24 — `community_posts.topic_id` single-column FK with documented exception [LOW]

**Where:** `packages/db/src/schema/operations.ts:195-246` (esp. 197-199, 240-245)

**Finding:** Schema documents the gap explicitly:

```ts
// F-10 community_posts.topic_id INTENTIONALLY left as single-column FK.
// Topics can be system-level (`club_id IS NULL`); a naive composite would
// block per-club posts from referencing system topics. Solving needs a
// partial constraint or a topic-club materialization; deferred until
// the community feature ships.
```

A forged `topicId` from another club is currently accepted at the DB layer when a member POSTs a community post. The community feature is documented as not-yet-shipped (no consuming routes), so this is dormant.

**Why it matters:** Latent. No exploit path today. But the schema ships in production migrations; a contributor adding the feature without re-reading the comment block misses the constraint and wires cross-tenant smuggle on the way in.

**Recommendation:** When community-write routes ship, gate `topicId` with explicit lookup `getCommunityTopicVisibleToClub(clubId, topicId)` returning rows where `topic.clubId = clubId OR topic.clubId IS NULL`. Or ship a partial FK + CHECK (`topic.clubId IS NULL OR topic.clubId = post.author_club_id`).

---

### F-25 — `competitions/calendar` filter schema is non-strict [LOW]

**Where:** `apps/web/app/api/v1/competitions/calendar/route.ts:9-25`

**Finding:** `calendarFiltersSchema` is `z.object({ dateFrom, dateTo }).refine(...).refine(...)` with no `.strict()`. Other inline GET filters (`booking-slots/route.ts:39-41`, `discover/clubs/route.ts:22`, `coupons/route.ts:41`) call `.strict()` correctly.

**Why it matters:** Defense-in-depth gap. Without `.strict()`, a typo'd query param (`?dateFromm=…`) silently behaves as if no filter was supplied. Low impact on this GET-only endpoint.

**Recommendation:** Insert `.strict()` immediately after `z.object({...})` and before the first `.refine(...)`, matching the booking-slots pattern.

---

### F-26 — `community_votes`: no CHECK that exactly one of (postId, commentId) is set [LOW]

**Where:** `packages/db/src/schema/operations.ts:298-338`

**Finding:** Both `postId` and `commentId` are nullable. Two unique constraints `(memberId, postId)` and `(memberId, commentId)` independently treat NULL as "not equal," so a row with both NULL passes both unique checks. A row with both set creates double-counting.

**Why it matters:** Community feature isn't shipped, but the schema is the source of truth; a future endpoint with a poorly-validated body could write nonsense rows.

**Recommendation:**

```sql
ALTER TABLE community_votes
  ADD CONSTRAINT community_votes_target_xor_check
  CHECK ((post_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int = 1);
```

Mirror via Drizzle `check()`.

---

### F-27 — Migration 0033's `ALTER COLUMN status TYPE` block is not idempotent [LOW]

**Where:** `packages/db/migrations/0033_audit_2026_05_05_critical_fixes.sql:106-113`

**Finding:** Every other DDL block in the migration is wrapped in `DO $$ … IF NOT EXISTS … END $$;`, but the `ALTER TABLE "webhook_events" ALTER COLUMN "status" DROP DEFAULT, …` step runs unconditionally. The migration header claims "all steps idempotent" — false for this block.

**Why it matters:** Runtime tracks per-migration tags so this won't bite a normal forward apply. But the project's stated invariant is forward-only AND idempotent.

**Recommendation:** Wrap the ALTER block in a `DO $$ ... END $$;` checking `pg_type` for the new enum and current column type. Or remove the "all steps idempotent" claim from the file header.

---

### F-28 — `lessonTypes.maxRiders` vs `lessonTypes.minRiders` no CHECK [LOW]

**Where:** `packages/db/src/schema/bookings.ts:80-114`

**Finding:** Both default to 1; no `min_riders <= max_riders` enforcement. `createLessonTypeSchema` (`packages/shared/src/schemas/index.ts:307-321`) likewise doesn't refine. A misclick (`min=4, max=2`) silently produces a lesson type that never matches any slot.

**Why it matters:** Low impact, but cheap to enforce.

**Recommendation:** Add `check('lesson_types_riders_minmax_check', sql\`${table.minRiders} <= ${table.maxRiders}\`)`to table-extras and a matching`.refine(...)`on`createLessonTypeSchema`.

---

### F-29 — `auditLog` actor + club FKs MATCH SIMPLE assumption needs verification in migration 0047 [LOW]

**Where:** `packages/db/src/schema/operations.ts:392-435`, `packages/db/migrations/0047_audit_r5_schema_drift.sql`

**Finding:** TS schema declares composite FK `audit_log_actor_member_club_fk` with no MATCH option (Drizzle defaults MATCH SIMPLE). Comment at lines 398-405 relies on this — system rows with `clubId=NULL OR actorMemberId=NULL` skip the composite check. A MATCH FULL composite would block every system audit row.

**Why it matters:** If migration 0047 emitted `MATCH FULL`, every audit insert with a NULL field would error.

**Recommendation:** Visually confirm migration 0047 uses bare `FOREIGN KEY (...) REFERENCES …` syntax (MATCH SIMPLE by default). If not, ship a follow-up migration to relax it.

---

### F-30 — `bookings.amount` nullable without CHECK enforcing NOT NULL when status indicates billable [LOW]

**Where:** `packages/db/src/schema/bookings.ts:209`

**Finding:** `amount: integer('amount')` — nullable. Stamped from `slot.lessonTypePrice` post-coupon (`apps/web/app/api/v1/bookings/route.ts:305-346`). Read paths either treat null as zero (no-show route at `bookings/[bookingId]/no-show/route.ts:55`) or guard. The `bookings_refund_le_amount_check` uses `COALESCE(${table.amount}, 0)`.

**Why it matters:** Defense-in-depth. A null `amount` on a non-cancelled booking is functionally a bug — refund cap silently allows `refundedAmountMinor <= 0`, no-show fee becomes `NaN`. DB doesn't enforce that the column is set when booking is `confirmed`/`completed`.

**Recommendation:** Add `check('bookings_amount_required_when_confirmed_check', sql\`amount IS NOT NULL OR status IN ('cancelled','pending','no_show')\`)`. Verify historical data first.

---

### F-31 — Clerk webhook returns 503 when secret unset, causing svix retry storm [LOW]

**Where:** `apps/web/app/api/webhooks/clerk/route.ts:112-116`

**Finding:** When `CLERK_WEBHOOK_SECRET` is missing, route returns `503 'Webhook secret not configured'`. Svix retries 5xx for ~24h; if the secret is missing in production, every Clerk event piles up retries until operator fixes the env. `logger.error('clerk_webhook_no_secret')` already fires, but 503 amplifies the alert to one-per-event-per-retry.

**Why it matters:** Operator-actionable, but the retry storm muddies tail logs and burns Worker CPU until noticed.

**Recommendation:** Return 401 (falls outside svix's 5xx retry band) or 200 with an error log (operator-actionable, not retry-recoverable). Consistent with the AI-15 unified-rejection pattern.

---

### F-32 — `attachWebhookEventClub` after-path silently drops in cron context [LOW]

**Where:** `apps/web/lib/payments/webhook-helpers.ts:305-334`

**Finding:** ClubId stamp on `webhook_events` row wrapped in `next/server`'s `after()`. Fallback for when `after()` throws (cron contexts) is `void attachTask()` — fire-and-forget. In the void-path fallback, if isolate is evicted before the bare promise resolves, the UPDATE silently drops with no log emitted (`logger.warn` inside the catch needs the JS engine still running).

**Why it matters:** Defense-in-depth degrades silently in cron path. Not a payment-correctness issue (dedup row is `processed` by the time `after()` fires), but per-club observability indexes (`idx_webhook_events_club_status`) can be partially missing.

**Recommendation:** Emit a `cron_post_processing_after_unavailable` count metric (or single `logger.error` per cron run) so the after-unavailable case becomes visible. Or accept the trade-off and document that per-club observability is best-effort during cron.

---

### F-33 — Stripe webhook `event.account` cross-tenant guard never fires in direct-keys path [LOW]

**Where:** `apps/web/app/api/webhooks/stripe/[clubId]/route.ts:140-151`

**Finding:** Cross-account check requires both `event.providerAccountId` and `account.externalAccountId` populated AND disagree. Comment acknowledges that in direct-keys mode `event.account` is never set, so the guard short-circuits in production. URL-bound clubId + per-club `whsec_…` is the only binding signal. Correct given Cavaliq is not a Connect platform — but depends on operators using _distinct_ `whsec_…` per club. Connect form doesn't validate the secret hasn't been pasted by another club.

**Why it matters:** A copy-paste mistake (one operator using same `whsec_…` for two clubs because they configured both clubs in one Stripe dashboard) defeats URL-binding: a Club A webhook landing on `/stripe/<clubB-id>` verifies against Club B's identical secret, then fails at booking-resolution (`findBookingByProviderPaymentId(…, clubId)`). System fails closed but operators have no signal at config time.

**Recommendation:** Add uniqueness check at connect time: SHA-256-hash the webhook secret, store the hash in a sibling column. Reject connect with clear error if hash matches another club. Hash is fine cleartext for collision detection.

---

### F-34 — Webhook dedup retry-recovery has 5-minute stale window [LOW]

**Where:** `packages/db/src/queries/webhook-events.ts:44-54`

**Finding:** `STALE_AFTER_MS = 5 * 60 * 1000`. A Worker that takes the `received` claim and crashes mid-processing (eviction, OOM) holds the claim for 5 full minutes before next retry can re-claim. Most webhook processing here is sub-second.

**Why it matters:** A real Worker crash leaves the event stuck up to 5 minutes. Combined with the `?from=payment` rider-facing post-redirect page that polls for status, this is user-visible.

**Recommendation:** Tighten `WEBHOOK_STALE_AFTER_MS` to ~60s in production (env var already plumbed). 60s is comfortably above any plausible non-crash latency.

---

### F-35 — `findBookingByIdInDescription` regex matches anywhere in description [LOW]

**Where:** `packages/db/src/queries/payment-accounts.ts:646`

**Finding:** `BOOKING_DESCRIPTION_MARKER_REGEX = /\[booking:([0-9a-fA-F]{8}-…)\]/`. Marker is appended at create-time. Within-tenant attacker (a club admin who can edit lesson type names AND is a rider) could potentially redirect a webhook to a different booking by embedding `[booking:<other-uuid>]` in lesson type name. Lookup is tenant-scoped via `clubId` (cross-tenant blocked), but within-tenant correctness depends on no rider-controlled field flowing into the description.

**Why it matters:** Within-tenant only. The marker is the LAST recovery branch; primary paths (provider_payment_id, metadata.bookingId) succeed first.

**Recommendation:** Anchor regex to the END of description: `/\[booking:([0-9a-f-]{36})\]\s*$/i`. Or document the assumption in `types.ts` `descriptionForRecovery`.

---

### F-36 — Booking-refund route's `cancellationFee` snapshotted pre-lock [LOW]

**Where:** `apps/web/app/api/v1/bookings/[bookingId]/refund/route.ts:107, 191`

**Finding:** `cancellationFee` read from pre-lock snapshot (line 107) and used inside locked transaction (line 191) to compute `liveRemaining`. Comment asserts immutability post-`markBookingNoShow/cancelBooking`. True for current callers, but no DB-level immutability constraint. A future writer mutating `cancellationFee` between pre-lock read and locked CAS would silently produce wrong refund.

**Why it matters:** Latent. Lock self-containment principle elsewhere in the file (audit forced `providerPaymentId` into locked SELECT for exactly this reason) is violated here.

**Recommendation:** Include `cancellationFee` in the locked `tx.select` block at line 149; use locked value at line 191.

---

### F-37 — Booking-payment route's `account.metadata.defaultCurrency` typed `unknown` [LOW]

**Where:** `apps/web/app/api/v1/bookings/[bookingId]/payment/route.ts:144-148`

**Finding:** `meta?.defaultCurrency` accessed via `Record<string, unknown>` and cast to string. If a future schema change stores `defaultCurrency` as object/null, comparison `booking.currency.toUpperCase() !== accountCurrency` silently passes (accountCurrency null) and the currency-mismatch guard never fires.

**Why it matters:** Defense-in-depth gate. Provider would surface a mismatch eventually, but the early-fail UX of the audit fix is undermined.

**Recommendation:** Validate `accountMetadata` with a Zod schema in `getActivePaymentAccount` and return typed `defaultCurrency: string | null`.

---

### F-38 — Cron-secret rotation drift is invisible mid-isolate-life [LOW]

**Where:** `apps/web/app/api/cron/livery-billing/route.ts:54-99` (and other cron routes)

**Finding:** `requireCronSecret` short-circuits with 401 on mismatch. Cron-secret binding self-check (`cron/self-check`) only runs at cold start (`worker-entry.mjs:48`); within an already-warmed isolate, partial secret rotation that updates `env.CRON_SECRET` mid-life would fail every subsequent cron tick at `requireCronSecret` and operator only sees `cron_secret_unauthorized` warns.

**Why it matters:** Operator visibility — secret-rotation drift is a real failure mode (audit history shows two distinct fixes).

**Recommendation:** `requireCronSecret` emits a structured `cron_secret_mismatch` at error level when header is present but doesn't match. Distinguishes binding-broken from secret-rotated.

---

### F-39 — N-Genius adapter's `getAccessToken` not retried [LOW]

**Where:** `apps/web/lib/payments/n-genius.ts:88-114`

**Finding:** `getAccessToken` flags `retryable: res.status >= 500 || res.status === 429` but call sites don't go through `withProviderRetry` — token-exchange happens inside the adapter method, fresh on every adapter invocation. Retries pay a second round-trip.

**Why it matters:** Performance at the margin — each retried adapter call costs 2x round-trips against N-Genius identity. Correctness fine.

**Recommendation:** Cache access token per-credentials-hash with 4-minute TTL (token TTL is 5min per comment at `n-genius.ts:35`). Material for cron runs that drive 50 invoices through one outlet.

---

### F-40 — `cloudflare-env.d.ts` `ProcessEnv` type omits secrets [LOW]

**Where:** `apps/web/cloudflare-env.d.ts:35`

**Finding:** Generated `ProcessEnv` only enumerates `vars` keys. Worker secrets (set via `wrangler secret put`) are intentionally excluded. `process.env.PLATFORM_ZIINA_API_KEY`, `process.env.ENCRYPTION_KEY`, `process.env.CRON_SECRET`, `process.env.WEBHOOK_STALE_AFTER_MS` are all secret-set but typoed accesses (`PLATFORM_ZINNA_API_KEY`) compile cleanly because `process.env` is `Record<string, string | undefined>` for unknown keys.

**Why it matters:** Defense-in-depth gap. Typo class.

**Recommendation:** Wrap `process.env` access through a typed `getSecret('PLATFORM_ZIINA_API_KEY')` helper in `packages/shared` listing the union of valid secret names. Avoids autogen drift.

---

### F-41 — Soft-delete invariant in audit prompt is documentation drift [LOW]

**Where:** `packages/db/src/schema/bookings.ts:132-294`, `livery-invoices.ts`, `finances.ts` (no `deleted_at`); only `clubs.ts:132` and `horses.ts:104` carry `deletedAt`

**Finding:** Audit prompt states "currently: bookings + invoices + payments soft, members hard with cascade." Schema disagrees — bookings use `cancelled_at` + `status='cancelled'` lifecycle; invoices use `status` enum transitions; payments derived from booking + invoice rows with no soft-delete column. DELETE handler at `apps/web/app/api/v1/bookings/[bookingId]/route.ts:63` is functionally a "cancel."

**Why it matters:** Documentation drift. New contributors could chase non-existent `deleted_at` columns or add hard `db.delete(bookingsTable)` calls.

**Recommendation:** Update CLAUDE.md / `DATABASE.md` with actual delete semantics: clubs + horses use soft-delete; bookings/invoices use status-flag cancellation; members use `is_active` flag plus hard-delete via Clerk webhook with FK cascade.

---

### F-42 — Audit retention 90 days silently differs from "every mutating action" promise [LOW]

**Where:** `packages/db/src/queries/audit-log.ts:90-113` (`pruneAuditLog(retentionDays = 90, limit = 5000)`)

**Finding:** Cron drops audit rows older than 90 days. Audit prompt says "Audit trail covers who did what + when for every mutating action" — but only for trailing 90 days.

**Why it matters:** Real risk in disputes/legal hold scenarios — a refund claim filed on day 91 has no audit row.

**Recommendation:** Pin retention policy in `DATABASE.md` next to the `audit_log` schema description. Consider archiving pruned rows to R2 (cold storage, JSON.gz) before DELETE for legal-hold replay.

---

### F-43 — Logger redaction relies on key naming discipline for unconventional keys [LOW]

**Where:** `apps/web/lib/logger.ts:106-145`

**Finding:** Two-layer scrub: `SENSITIVE_KEYS` (key-name match) plus `PII_PATTERNS` (regex value match for emails / international phones). Bare GCC phones (`0501234567`) only scrubbed when parent key is in `FREE_TEXT_KEYS`. `logger.info('foo', { detail: { rider_phone: '0501234567' } })` would not redact (parent key is `rider_phone`, not in `FREE_TEXT_KEYS`'s regex view).

**Why it matters:** Defense-in-depth gap, not a leak today.

**Recommendation:** Add `lib/logger.test.ts` fuzzer asserting every PHI shape exits as `[REDACTED]` regardless of nesting depth. Function already passes `parentKey` recursively — extend test surface.

---

### F-44 — `getMedicationLogs` list query uses bare `db.select()` (whole-row projection) [LOW]

**Where:** `packages/db/src/queries/horse-health.ts:325-331`

**Finding:**

```ts
db.select()
  .from(horseMedicationLogs)
  .where(where)
  .orderBy(desc(horseMedicationLogs.administeredAt))
  .limit(pageSize)
  .offset(offset);
```

Every other list query in `horse-health.ts` (health records 109-130, medications 211-232, feeding 367-380, exercise 466-479, documents 564-578) uses explicit projection. Logs is the lone holdout.

**Why it matters:** Inconsistent with the audit pattern. A future schema add (e.g., a PII-laden field) lands in the wire response with no per-row cost analysis.

**Recommendation:** Replace bare `.select()` with explicit projection mirroring `medication-log` consumption in `health-tab.tsx`.

---

### F-45 — `findUpcomingBookingsForReminder` SQL window 48h, JS narrows to 22-26h [LOW]

**Where:** `packages/db/src/queries/bookings.ts:1065-1130`, consumer `apps/web/app/api/cron/booking-reminders/route.ts:79-188`

**Finding:** Query bounds `bookingSlots.date BETWEEN today AND today+48h` and limits 500. JS filter at route line 144-153 narrows to [22h, 26h] window after timezone resolution. Wasted ~50% round-trip bandwidth on busy clubs.

**Why it matters:** Minor. Trade-off documented in docblock as intentional.

**Recommendation:** Acceptable as-is. If revisited, push timezone resolution into SQL via `AT TIME ZONE clubs.timezone` joined on `bookings.clubId → clubs.id`.

---

### F-46 — `getOutstandingPlatformInvoices` has no `.limit()` [LOW]

**Where:** `packages/db/src/queries/platform-billing.ts:534-557`, `apps/web/app/api/v1/me/subscription/route.ts:24`

**Finding:** `db.select(…).from(platformSubscriptionInvoices).where(eq(clubId), inArray(status, ['pending','overdue'])).orderBy(asc(dueDate))` — no `.limit()`. Sibling `getPlatformInvoicesByClub` accepts `limit = 24`; this one is unbounded.

**Why it matters:** Outstanding platform invoices for one club are intrinsically bounded (Cavaliq bills monthly; ~12-24 ceiling before suspension). Not a DoS surface, but inconsistent.

**Recommendation:** Add `.limit(100)` belt-and-braces. Mirrors `getPlatformInvoicesByClub`.

---

### F-47 — Reports route Zod validator does not cap date range [LOW]

**Where:** `apps/web/app/api/v1/reports/route.ts:11-17`

**Finding:** `reportFiltersSchema` accepts any `dateFrom`/`dateTo` matching `\d{4}-\d{2}-\d{2}` with no gap bound. `competitions/calendar/route.ts:7-25` enforces `MAX_CALENDAR_RANGE_DAYS = 90`; `booking-slots/route.ts:34-50` enforces `MAX_SLOT_RANGE_DAYS = 90`. A 10-year revenue-by-day query scans every booking in window.

**Why it matters:** Aggregation stays small (~3,650 rows for 10y), but underlying scan is unbounded; malicious admin can hammer with `dateFrom=1970-01-01&dateTo=2099-12-31` for full-table aggregate per call.

**Recommendation:** Add the same `.refine()` clause as `bookingSlotFiltersSchema`. 1-year cap is reasonable; UI filters at most 12 months.

---

### F-48 — Sentry rate-limit per-(level, event) is per-isolate, not global [LOW]

**Where:** `apps/web/lib/logger.ts:204-242`

**Finding:** `shouldForwardToSentry` keys on `${level}:${event}` and admits one event per second per tuple via module-scope `Map`. Comment at lines 212-220 acknowledges per-isolate scope; under horizontal load, 100 isolates × 1 event/tuple/sec multiplies the cap. Honestly documented.

**Why it matters:** In a runaway loop in one isolate, the local cap holds. Across many isolates, the cap multiplies. Sentry's quota burn mitigation is probabilistic rather than guaranteed.

**Recommendation:** Already documented honestly with upgrade path (Durable Object counter or Sentry server-side rate-limit). No action required unless quota incidents occur.

---

### F-49 — Mobile lacks Sentry integration [LOW]

**Where:** `apps/mobile/lib/api.ts:35`, `apps/mobile/lib/auth.ts:30,46`

**Finding:** Three `console.error` in mobile — `useApiClient`'s `onError`, two in Clerk token-cache failure paths. api.ts comment plans for `@sentry/react-native`. Logs only land in device/Metro console.

**Why it matters:** Production token-cache regression would not page anyone. Known gap, not a leak.

**Recommendation:** Add `@sentry/react-native` to mobile (already planned) so api/auth failures aggregate alongside web.

---

### F-50 — Horse profile sub-tabs use plain `<p>` instead of `EmptyState` [LOW]

**Where:** `apps/web/components/horses/health-tab.tsx:126`, `feeding-tab.tsx:57`, `exercise-tab.tsx:82`, `documents-tab.tsx:87`

**Finding:** Each tab's empty branch renders `<p className="py-8 text-center text-sm text-muted-foreground">No X yet. Add an X above.</p>` rather than the project-standard `<EmptyState .../>`. CTA ("Add X above") is prose, not clickable.

**Why it matters:** Discoverability — user must read prose, then look up at header. Visually inconsistent with the rest of the dashboard which uses `EmptyState` everywhere else.

**Recommendation:** Replace each `<p>` with `<EmptyState title="..." description="..." action={{ label: 'Add Record', onClick: () => setOpenDialog(true) }}/>`. Lift dialog open state to section root (the F-20 lift pattern).

---

### F-51 — Reports page summary cards mask cancellation failure [LOW]

**Where:** `apps/web/components/reports/reports-page.tsx:62-64,94-105`

**Finding:** `cancellationStats?.noShowBookings ?? 0`. When `cancellations.isError`, card shows `0%` / `0` — same as a zero-cancellation period. Other three cards in the row render inline `<ErrorState/>`.

**Why it matters:** A failed query renders as legitimate-looking data. Operator wouldn't realize stats are stale.

**Recommendation:** Pass `error: cancellations.isError` down to `SummaryCard`; render an inline error indicator instead of `0%`. Or hoist the error gate so all cards retry as a unit.

---

### F-52 — Sidebar pending-horses badge swallows errors silently [LOW]

**Where:** `apps/web/components/dashboard/sidebar.tsx:81-86`

**Finding:** `pendingHorsesQuery.data?.pagination.total ?? 0` returns 0 on both "no pending horses" and "query failed."

**Why it matters:** Failed query hides badge, so admin/manager wouldn't know there are pending horses.

**Recommendation:** Render a subtle `?` badge or muted dot when `pendingHorsesQuery.isError`. Don't toast.

---

### F-53 — `useClubSettings` errors silently fall back to `'AED'` in finance/reports [LOW]

**Where:** `apps/web/components/finances/finances-page.tsx:73-77`, `reports/reports-page.tsx:48-49`, `horses/health-tab.tsx:76-80`

**Finding:** Each reads `settings?.data.currency ?? 'AED'` without checking `useClubSettings()`'s `isError`. Settings-fetch failure renders entire page in AED regardless of club's actual currency. SAR/KWD/QAR clubs see misleading labels during a settings-API blip.

**Why it matters:** GCC clubs use AED (most common case), so fallback is correct for primary tenant — but cosmetic inaccuracy for non-AED.

**Recommendation:** Gate the page render on `settings.isLoading` / `settings.isError`. Or render `Skeleton` for currency-bearing values when loading.

---

### F-54 — `bookings/page.tsx` Server Component doesn't handle `getTenantContext` failure [LOW]

**Where:** `apps/web/app/(dashboard)/bookings/page.tsx:11-13`

**Finding:** `const ctx = await getTenantContext();` — if this throws (e.g., `NO_MEMBERSHIP` race during onboarding), Server Component crashes. No `error.tsx` boundary in this directory tree.

**Why it matters:** A Clerk webhook delivery race (org.created hasn't landed yet) would 500 the bookings page rather than redirecting to empty-state. `withAuth` middleware path treats `NO_MEMBERSHIP` as 503; Server Component path bypasses that.

**Recommendation:** Add `error.tsx` to `apps/web/app/(dashboard)/` handling `TenantError` (with "your account is being set up" message + refresh). Or wrap `getTenantContext()` in try/catch and redirect to `/onboarding` on `NO_MEMBERSHIP`. Same applies to other dashboard `page.tsx` files.

---

### F-55 — `arenaSchedules` table has composite FK but no consumers [NIT]

**Where:** `packages/db/src/schema/bookings.ts:52-78`

**Finding:** Composite FK correctly applied (`arena_schedules_arena_club_fk`). Comment says "Schema-completeness — table currently has no consumers." Verified — no queries or routes reference it.

**Recommendation:** When this table gets a consumer, the read query MUST include `eq(arenaSchedules.clubId, ctx.clubId)`. Add an empty `arenas-schedules.ts` query stub now with `// TODO(when first consumer ships): always scope by clubId`.

---

### F-56 — Coach `riders:read` permission relies on `getTenantContext` re-resolving role [NIT]

**Where:** `apps/web/lib/permissions-shared.ts:40-51`, `apps/web/lib/tenant.ts:84-94`

**Finding:** Coaches have `riders:read`. Verified all rider-list queries scope by `clubId`. Cross-club leak case (coach session has different `orgId` than tenant) is closed by `tenant.ts:84-94` always re-resolving role from `club_members` for resolved club.

**Recommendation:** None — current implementation is correct. Calling out only because the rule "Clerk org role MUST be re-resolved against `club_members`" is load-bearing; if dropped (e.g., a future "use Clerk org role directly when present" optimization), every cross-club permission boundary breaks.

---

### F-57 — `me/horses/[horseId]/retire` audit row uses active-club memberId for foreign target club [NIT]

**Where:** `apps/web/app/api/v1/me/horses/[horseId]/retire/route.ts:64-82`

**Finding:** Route correctly scopes via `getHorseOwnershipByUser(ctx.userId, horseId)` and uses `ownership.clubId` for the audit row's `clubId`. But `actorMemberId: ctx.memberId` uses active-tenant memberId — may differ from user's memberId at `ownership.clubId` if they belong to multiple stables.

**Why it matters:** Audit-log corruption, not security. Audit row ends with `clubId=B` but `actorMemberId=<member at A>`, violates composite FK on `audit_logs(actor_member_id, club_id) → club_members(id, club_id)`. Likely throws on insert → caught by error handler → silently logged but no row written.

**Recommendation:** Resolve user's memberId in target club at `getHorseOwnershipByUser` time. Or call `getMemberByClerkUserAndClub(ctx.userId, ownership.clubId)` before the audit write.

---

### F-58 — Stale comment on bookings partial unique indexes references wrong migration [NIT]

**Where:** `packages/db/src/schema/bookings.ts:269-275`

**Finding:** "see the partial unique indexes `idx_bookings_unique_rider_slot` and `idx_bookings_unique_guest_slot` in migration 0009." Actual migration is 0015 (`packages/db/migrations/0015_booking_guest_fields.sql:44-53`).

**Why it matters:** Every Drizzle-schema audit comment is load-bearing because the project explicitly does NOT use `drizzle-kit generate`.

**Recommendation:** Update to `0015_booking_guest_fields.sql`.

---

### F-59 — `clubs.lateCancellationFeePercent`/`noShowFeePercent` numeric → `Number(...)` no NaN guard [NIT]

**Where:** `packages/db/src/schema/clubs.ts:83-86`, `apps/web/app/api/v1/bookings/[bookingId]/no-show/route.ts:55`

**Finding:** `numeric` columns return strings from Drizzle. Consumer wraps with `Number(...)` — silently produces `NaN` for malformed values. No type guard. Today only writer is `updateBookingRulesSchema` constraining to `[0,100]`, so contract holds — but not enforced at read boundary.

**Recommendation:** Parse-and-validate via `coerceFeePercent(value): number throws`, or change column to `integer` basis points (×100).

---

### F-60 — `riderAchievements.notified` mutable but no `updated_at` [NIT]

**Where:** `packages/db/src/schema/operations.ts:137-160`

**Finding:** `notified` boolean flips when notifier emails the rider. Table comment acknowledges CLAUDE.md rule violation. Notifications got the same fix in migration 0044; achievements wasn't backfilled.

**Recommendation:** Add `updatedAt timestamp NOT NULL DEFAULT now()` via new migration backfilling with `unlocked_at`, mirror in TS schema, update `markAchievementNotified` to stamp `updatedAt`.

---

### F-61 — Webhook dedup constraint name doesn't reflect entropy contract [NIT]

**Where:** `packages/db/src/schema/webhook-events.ts:88` (`unique('webhook_events_provider_event_unique').on(table.provider, table.eventId)`)

**Finding:** Constraint name accurately describes columns. Comment at lines 53-66 (correct, well-reasoned post-r2 fix) implicitly relies on each adapter producing globally-unique event IDs per merchant — `derivedEventId` for N-Genius (`apps/web/lib/payments/n-genius.ts:758-781`) and Ziina composite key with body-hash tie-breaker (`apps/web/lib/payments/ziina.ts:381-413`). Both sound.

**Recommendation:** None — webhook dedup composite is correctly designed.

---

### F-62 — `lessonTypes.color` Zod accepts any 7-char string [NIT]

**Where:** `packages/shared/src/schemas/index.ts:319` (`color: z.string().max(7).optional()`) vs `packages/db/src/schema/bookings.ts:100` (`color: varchar('color', { length: 7 })`)

**Finding:** Schema accepts `color: 'red'` or `color: 'verybad'`. Compare `updateBrandingSchema` which uses the `hexColor` refinement.

**Recommendation:** Reuse `hexColor` schema for `createLessonTypeSchema.color` (export `hexColor`).

---

### F-63 — `sendBookingReminders` doesn't log `hoursFromNow` on matched bookings [NIT]

**Where:** `apps/web/app/api/cron/booking-reminders/route.ts:144-153`

**Finding:** DST window widened from 23-25h to 22-26h. Good fix. But no log of `hoursFromNow` on matched-but-claimed path.

**Recommendation:** Add `hoursFromNow` to `booking_reminder_send_failed` and the success log inside `sendTriggeredEmail`.

---

### F-64 — `n_genius_webhook_reference_freshness_check_failed` fails open [NIT]

**Where:** `apps/web/app/api/webhooks/n-genius/route.ts:218-225`

**Finding:** When freshness DB lookup throws, route logs warn and falls through. Comment correctly notes the secondary defense (90s event freshness in `n-genius.ts:708`) doesn't depend on this. During a sustained DB outage, the rest of the pipeline fails too.

**Recommendation:** No change. Trade-off documented for completeness.

---

### F-65 — Cron `self-check` accepts GET [NIT]

**Where:** `apps/web/app/api/cron/self-check/route.ts:23-27`

**Finding:** Other cron routes dropped GET in favor of POST + header to keep secret out of access logs. Self-check uses GET deliberately — `worker-entry.mjs:53` calls it via GET. Secret rides in `x-cron-secret` header, not URL.

**Recommendation:** Add comment to `self-check/route.ts` noting GET is intentional because secret is in header.

---

### F-66 — `applyCumulativeRefundFromWebhook` retry has no exponential backoff [NIT]

**Where:** `apps/web/lib/payments/webhook-helpers.ts:60-146`

**Finding:** CAS-skip retry loop runs `CUMULATIVE_REFUND_RETRY_ATTEMPTS = 3` in immediate succession. With FOR UPDATE in place, contended rows queue naturally, so each attempt waits on the lock anyway.

**Recommendation:** No code change. If `permanently_failed` ever fires for this reason, operator's reconciliation step is straightforward. Optional bump to 5 attempts.

---

### F-67 — `getExpenseById` / `getCouponByCode` / detail-by-id reads use bare `db.select()` [NIT]

**Where:** `packages/db/src/queries/finances.ts:170,346`, `audiences.ts:51`, `arenas.ts:69`, `lesson-types.ts:74`, `competitions.ts:120,230`, `payment-accounts.ts:151,170,379,404,426`

**Finding:** Each uses `.select().from(table).where(...).limit(1)` — single-row by-id reads return every column including wide-table content (e.g., `payment_accounts.encrypted_credentials` ciphertext blob).

**Why it matters:** Single-row, size-impact trivial. Type-safety impact: inferred row type is full `$inferSelect`, coupling consumers to columns they don't care about.

**Recommendation:** Add explicit column projections opportunistically. Lower priority than F-44.

---

### F-68 — `account.metadata` cast to `Record<string, unknown>` [NIT]

**Where:** `apps/web/app/api/v1/bookings/[bookingId]/payment/route.ts:144`

**Finding:** `const meta = (account.metadata ?? null) as Record<string, unknown> | null;` — single shipped `as Record<string, unknown>` cast outside audit-log/logger/api-client boundaries. Consumer reads named keys without guarding.

**Recommendation:** Narrow with type-guard helper or define `PaymentAccountMetadata` discriminated union per provider in `apps/web/lib/payments/types.ts`.

---

### F-69 — `apiClient.get<T>` / `fetchJson<T>` boundary: unvalidated cast [NIT]

**Where:** `packages/api-client/src/client.ts:45-65`, `73-108`, `apps/web/lib/fetch-json.ts:69`

**Finding:** Envelope shape (`success`, `error.code/message`) shape-checked at runtime. `obj.data` is then `as T` with no per-route runtime validation. Repo's audit comment at `client.ts:36-44` documents this and defers Zod-validation pass.

**Why it matters:** Accepts cost of a server bug propagating into TanStack cache silently. Not exploitable. NIT, called out so deferral is visible — and because if F-4 lands, per-route Zod becomes natural follow-up.

**Recommendation:** Companion task to F-4. Define a Zod schema per shared response type in `packages/shared/src/schemas/responses/`; `apiClient.get<T>(path, schema)` narrows with `schema.parse(envelope.data)` before returning.

---

### F-70 — Web `useHorses` query keys conflate list/detail invalidation [NIT]

**Where:** `apps/web/hooks/use-horses.ts:111` (`['horses', filters]`), `:173` (`['horses', horseId]`); same in `use-horse-health.ts:107`

**Finding:** List uses `['horses', filters]`; detail uses `['horses', horseId]`. Mutations invalidate via `['horses']` prefix → both branches evict. Hook docblock acknowledges acceptable trade-off.

**Recommendation:** If revisited, structure as `['horses', 'list', filters]` vs `['horses', 'detail', horseId]` so mutations target precisely.

---

### F-71 — No code-splitting present (and none needed today) [NIT]

**Where:** Whole tree.

**Finding:** Zero `next/dynamic` imports. No tree-shakeable charts/rich-text/PDF/canvas libs imported. Reports page is ~200 lines of skeletons + hooks. ROI on splitting genuinely low.

**Recommendation:** None. Re-evaluate if Recharts / TanStack Table v8 / a date-grid / a rich-text editor lands.

---

### F-72 — Health probe deliberately untagged [NIT/INFO]

**Where:** `apps/web/app/api/v1/health/route.ts:87`

**Finding:** `logger.error('health_deep_probe_failed', { subsystems })` doesn't carry `clubId` — by design, system-level probe.

**Recommendation:** Optionally tag with `tag: 'system'` if Sentry filtering becomes painful. Otherwise none.

---

### F-73 — Package-side `console.warn`/`error` are intentional and justified [NIT]

**Where:** `packages/db/src/queries/payment-accounts.ts:62,84`, `packages/db/src/queries/audit-log.ts:62`

**Finding:** Three `console.*` calls in `packages/db/`, which by design cannot import the app-side logger (circular dep). All emit structured JSON matching logger output shape, document rationale in block comments. Audit-log fallback is "audit trail of last resort."

**Recommendation:** Document the constraint in `CLAUDE.md` if a future audit points at these.

---

### F-74 — Cron rate-limit warnings tag `clubId` consistently [NIT/INFO]

**Where:** `apps/web/app/api/cron/platform-billing/route.ts:208,215,268,394,444,456,531,539`

**Finding:** Every per-club iteration tags `clubId` — point-debugging supported.

**Recommendation:** None. Confirming compliance.

---

### F-75 — Mobile `Alert.alert` for terminal failures is intentional [NIT/INFO]

**Where:** `apps/mobile/app/(tabs)/book.tsx:153,199-202`

**Finding:** Per audit-r5 F-55 closeout, success/warning toasts moved to `react-native-toast-message`, but terminal "Booking Failed"/"Payment Failed" uses `Alert.alert` so user must dismiss. Doc-comment at `:159-163` says intentional.

**Recommendation:** None. Documented design.

---

### F-76 — Comprehensive observability layer at the gold standard [NIT/INFO]

**Where:** Webhooks: `apps/web/app/api/webhooks/stripe/[clubId]/route.ts:66,90,99,107,120,123,145,154,164,173,182,247`. Cron: `apps/web/app/api/cron/booking-reminders/route.ts:44,51,63,128,237`. Auth: `apps/web/app/api/webhooks/clerk/route.ts:108,114,128,141,158,172,187,245,252,271,287,311,340,362,380,401,419,427,435`. Payment apply: `apps/web/lib/payments/webhook-helpers.ts:260,310,320,328,351,387,417,440,464,477,555,569,583,602,631,643,659,675,699,712,732,765,773,784,794,808,830,838,928`.

**Finding:** Every critical-path branch (signature missing/invalid, club not connected, secret not configured, account mismatch, dedup hit, in-flight, permanently failed, processing failed, currency mismatch, underfunded, overfunded, refund reversed, status downgrade) emits a typed event. Cron entry/exit pairs (`*_cron_started`/`*_cron_completed`/`*_cron_failed`) bracket each run.

**Recommendation:** None — confirming the bar is met. Operators can reconstruct any failure mode from logs without code spelunking.

---

## Auditor self-check

- [x] Every finding has `**Where:**` with line numbers.
- [x] No tautological findings.
- [x] No "you should add tests for X" without specific test gap.
- [x] No refactor-disguised-as-bug findings.
- [x] Severity matches rubric — no NIT promoted to MED.
- [x] Summary count (5 HIGH + 14 MED + 36 LOW + 21 NIT = 76) matches finding count.
- [x] Findings in severity order; within severity by category letter (A→N).

## Implementer guidance

The five HIGH findings cluster into three logical PR groups:

- **PHI encryption (F-2 + F-3)**: One PR, one migration adding `MEDICATION_LOG_ENCRYPTED_FIELDS` + `FEEDING_PLAN_ENCRYPTED_FIELDS` + `EXERCISE_SCHEDULE_ENCRYPTED_FIELDS`, three backfill scripts, three verifier migrations. Mirror the rider-medical-notes pattern at `scripts/backfill-rider-medical-notes.mjs`. Verify with `pg_constraint`/data-shape probes against prod.
- **Coupon enum + filter hardening (F-1 + F-7)**: One PR. F-1 fixes the user-visible 500; F-7 generalizes the lesson to `documents`/`members` GET filters by parsing every enum-bound query param through Zod against the canonical literal tuple.
- **Response DTO consolidation (F-4)**: Larger PR — moves shape declarations to `packages/shared/src/types/responses/`, wires `packages/api-client/src/endpoints/index.ts`, deletes per-hook DTO duplicates. Companion follow-up: F-69 (Zod runtime validation per route).
- **Audiences performance (F-5)**: Standalone PR. Either push counts into SQL (preferred) or hard-cap the in-memory load with `MEMBERS_PREVIEW_CAP`.

The 14 MED findings split naturally into webhook hardening (F-6, F-12, F-13), refund correctness (F-10, F-11), upload/route hygiene (F-8, F-17), schema/audit (F-9, F-18, F-19), cron performance (F-14, F-15), mobile UX (F-16). Bundle by area, not by severity.

LOW and NIT findings can be opportunistically closed as the surrounding code is touched. Each LOW carries an actionable recommendation; NITs are advisory.

The 0 CRITICAL outcome is meaningful: five rounds of audit have closed every exploitable bug. The residual surface is what good defense-in-depth looks like — gaps that won't trigger on the happy path but are worth closing for the next round of growth.
