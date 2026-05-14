# End-to-End Test Setup

This document — promised by `apps/web/playwright.config.ts:1-21` and the audit
2026-05-13 follow-up — outlines what's needed to lift the `test.fixme`'d
critical-flow specs in `apps/web/e2e/booking-flow.spec.ts`.

The existing smoke suite (`*.smoke.spec.ts`) runs API-only assertions
against any environment and is safe in prod. The full browser flow tests
documented here are intended for local + CI-dev only — they mutate state.

## What's needed

### 1. Test club seed script

A reusable script that, given a clean dev DB, creates:

- A "Cavaliq E2E Test Stable" club with `slug = 'e2e-test'`, `joinPolicy = 'open'`, `isPublicListing = true`.
- One arena, one lesson type (group, AED 100), one recurring weekly slot at 09:00.
- A `club_payment_accounts` row with **Stripe test-mode credentials** (`sk_test_…` / `pk_test_…`) — secret-paste model, not Connect.

The script should be **idempotent** (re-running it doesn't crash if the
club already exists; it just updates the configurable fields) and runnable
via `pnpm tsx scripts/seed-e2e.ts`.

### 2. Clerk test mode

Create a separate **Clerk dev instance** for E2E (don't reuse the prod
instance — Clerk's free tier caps members and we don't want test churn
polluting prod analytics).

Configure the seed script to use the Clerk dev instance's keys via env:

```
E2E_CLERK_PUBLISHABLE_KEY=pk_test_…
E2E_CLERK_SECRET_KEY=sk_test_…
```

Pre-create a single test user `e2e-rider@cavaliq.local` with a known
password, stored in repo secrets:

```
E2E_TEST_USER_EMAIL
E2E_TEST_USER_PASSWORD
```

Pass these to Playwright via `process.env` and use them in a `beforeAll`
to sign in once per worker (Clerk's `signIn.create()` from
`@clerk/clerk-js` if the spec uses a session cookie, or the regular
form-fill if the spec exercises the UI).

### 3. Stripe test-mode card

Stripe's hosted Checkout uses an iframe and is fragile to DOM-scrape from
Playwright. Two viable approaches:

**Option A — programmatic:** in the test setup, call Stripe's
`/v1/payment_methods` API with the test card `tok_visa` (or the modern
`pm_card_visa` payment method) and confirm the PaymentIntent via API
before navigating back to `/rider/bookings/[id]?from=payment`. This
sidesteps the iframe entirely. Best for CI.

**Option B — UI driven:** use `page.frameLocator('iframe[name^="__privateStripeFrame"]')`
to fill the test card. Brittle across Stripe redesigns; better suited for
local debugging than CI.

Recommend Option A in CI. Document the card token used in repo secrets:

```
E2E_STRIPE_TEST_PAYMENT_METHOD=pm_card_visa
```

### 4. Reset mechanism

After each spec, either:

- Truncate the bookings + payments rows for the e2e-test club (script:
  `scripts/reset-e2e.ts`), OR
- Use Playwright's `beforeAll` to spin up an ephemeral Neon branch
  (`branch-create` via Neon API), apply migrations, run the suite, then
  destroy the branch.

The neon-branch approach is cleaner but adds 30s of cold-start. For
nightly CI the truncation approach is fast enough.

### 5. CI workflow

Add `.github/workflows/e2e-nightly.yml`:

- Trigger: cron `0 4 * * *` (04:00 UTC, ~1h after the lowest US/EU
  traffic crossover)
- Job: provision Neon branch → seed → `pnpm test:e2e` → tear down
- Failure: page the operator (the existing Sentry alert pipeline can
  consume Playwright's GitHub reporter output)

## What to delete

Once the infra above is in place, drop the `test.fixme(...)` from each
test in `apps/web/e2e/booking-flow.spec.ts` and the suite becomes a
deploy gate.

## What this audit pass actually shipped

The audit pass that produced this doc:

1. Added the booking-flow spec skeleton (3 tests, all `fixme`).
2. Documented the gap (this file).

The remaining work is infrastructure provisioning, not code. It's
captured here so the next implementer doesn't have to rediscover the
shape of the problem.
