# Environment Variables — Operator Reference

Audit LOW-14 (2026-05-05): the .env.example template is short on the *why*
behind each variable. This file is the long-form companion — it tells you
**why** the variable exists, **where** it's read (Worker runtime, build step,
CI), and **when** it's required (dev / prod / both). The .env.example
stays as the copy-paste template.

If you're onboarding, copy `.env.example` → `.env.local` and fill the dev
slots; this file explains what each one *does* and what breaks if you skip
it. Production secrets live in Cloudflare Workers Secrets (set via
`wrangler secret put NAME` or the dashboard) and GitHub Actions Secrets
(for CI), **never** in repo files.

---

## Application

### `NEXT_PUBLIC_APP_URL`
- **Where:** browser bundle + Worker runtime
- **When:** required in prod (payment-init route 503s without it); dev
  defaults to `http://localhost:3000`
- **Why:** Stripe / N-Genius / Ziina need an absolute return URL, so we
  build `${NEXT_PUBLIC_APP_URL}/rider/bookings/{id}` server-side. A
  relative fallback would silently misconfigure every provider.
- **Prod value:** `https://cavaliq.com`

### `NODE_ENV`
- **Where:** everywhere
- **When:** auto-set by Next.js build (`production`) and dev server
  (`development`) — only override for parity testing.

---

## Auth (Clerk)

### `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- **Where:** browser bundle (publishable) + Worker (secret)
- **When:** both required in dev and prod
- **Why:** Clerk SDK boot. Mismatched live/test mode crashes auth — see
  `lib/clerk-keys.ts` for the parity check.

### `CLERK_WEBHOOK_SECRET`
- **Where:** Worker (verify Svix signature)
- **When:** required in prod (org/membership lifecycle webhooks
  permanently fail without it)
- **Why:** `/api/webhooks/clerk` rejects unsigned requests; without the
  secret an attacker could forge `organization.created` events.

### `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- **Where:** browser bundle (Clerk's `<SignIn>` component routes here)
- **When:** required in dev and prod
- **Why:** Clerk needs to know where to send unauthenticated users.

---

## Database (Neon)

### `DATABASE_URL`
- **Where:** Worker runtime (every query) + build step
  (`scripts/collect-page-data.mjs` reads it to build the static-data
  prerender — see DEPLOY.md for the build-time stub used by `cf:build`)
- **When:** required in dev and prod
- **Why:** Drizzle's HTTP driver connects via this URL. The pooled
  variant is the default; the unpooled variant powers `writeTransaction`
  through neon-serverless's WebSocket Pool.
- **Prod note:** must include `?sslmode=require`.

### `DATABASE_URL_UNPOOLED`
- **Where:** migrations runner (`scripts/migrate-neon.mjs`) and any DDL
- **When:** required when running `pnpm db:migrate:neon`
- **Why:** Neon's pooler can't run `CREATE TYPE` / `ALTER ENUM` /
  `CREATE INDEX CONCURRENTLY`. Use the direct (unpooled) URL for
  schema changes.

---

## Cloudflare R2 (File Storage)

### `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- **Where:** Worker (signed-upload + delete paths)
- **When:** required in prod; dev can stub if file uploads aren't tested
- **Why:** `lib/r2.ts` signs PUT URLs the browser uploads to directly.
  Without these, `<FileUpload>` returns "upload failed" toasts.

### `R2_PUBLIC_URL`
- **Where:** Worker (returned to clients) + browser (image src)
- **When:** required when R2 keys are set
- **Why:** R2 buckets aren't public by default; this is the
  `https://files.cavaliq.com` style custom domain or the
  `pub-<id>.r2.dev` development URL.

---

## Payments

### Stripe — *no platform env vars*
Cavaliq is **not** a Stripe Connect platform. Each club pastes their
own `sk_…` / `pk_…` / `whsec_…` into Settings → Payments; the keys are
encrypted into `club_payment_accounts.encrypted_credentials` and used
per-club. There is no `STRIPE_CLIENT_ID`, no platform `whsec_`, no
OAuth flow. Audit AI-* (2026-05-04 pivot from Connect).

### N-Genius — `N_GENIUS_API_BASE_URL`
- **Where:** Worker (per-club payment + refund + webhook routes)
- **When:** prod uses the real gateway; sandbox testing overrides
- **Why:** N-Genius doesn't expose a per-merchant base URL — same host
  serves everyone, and we route per-club through the API key the club
  pasted into Settings → Payments.
- **Prod value:** `https://api-gateway.ngenius-payments.com`

### Ziina — `ZIINA_API_BASE_URL`
- **Where:** Worker (per-club rider payments + platform billing)
- **When:** dev/prod
- **Why:** Same as N-Genius — single host, per-club routing via API
  key.
- **Prod value:** `https://api-v2.ziina.com/api`

### `PLATFORM_ZIINA_API_KEY`
- **Where:** Worker (Round 6 platform-billing cron + payment-link
  endpoint)
- **When:** required in prod (without it the Round 6 cron skips clubs
  on Ziina-funded subscriptions and clubs see no pay link)
- **Why:** Cavaliq's **own** Ziina merchant account that bills clubs
  the monthly subscription (Starter / Growing / Professional). Distinct
  from the per-club Ziina keys above — those receive *rider* payments;
  this one receives the *club's subscription* payment.

### `PLATFORM_ZIINA_WEBHOOK_SECRET`
- **Where:** Worker (`/api/webhooks/ziina-platform`)
- **When:** required in prod (otherwise paid platform invoices won't
  auto-flip to `paid`; clubs see stale "due" badges even after
  settling)
- **Why:** HMAC-SHA256 over the request body, compared to the
  `X-Hmac-Signature` header. Configure the webhook in Ziina's business
  dashboard pointing at `https://cavaliq.com/api/webhooks/ziina-platform`.

### `PLATFORM_ZIINA_TEST_MODE`
- **Where:** Worker (`apps/web/lib/billing/platform-ziina.ts`)
- **When:** optional, **staging / preview only** (set `true`); leave
  unset or `false` in production. Audit F-10 (2026-05-07 r5).
- **Why:** drives the Ziina sandbox `test` flag on every platform
  payment-intent create. Without it, a staging worker provisioned with
  a sandbox `PLATFORM_ZIINA_API_KEY` will issue *live* intents that
  Ziina will either reject (best case) or mis-route (worst case). The
  prod env-check (`assertProductionEnvConfigured`) emits a structured
  warning if `PLATFORM_ZIINA_TEST_MODE === 'true' && NODE_ENV ===
  'production'` so a staging template that leaks into prod fails loud.
- **How to set on staging:**
  ```bash
  cd apps/web
  npx wrangler secret put PLATFORM_ZIINA_TEST_MODE --env staging
  # paste: true
  ```

---

## CORS

### `CORS_ALLOWED_ORIGINS`
- **Where:** Worker (`lib/cors.ts`)
- **When:** required when serving the mobile/native app from a different
  origin
- **Why:** comma-separated list of allowed origins for cross-origin API
  calls. Empty = same-origin only.

---

## Observability (Sentry)

### Build-time — `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
- **Where:** build step (source-map upload) + Worker/browser (DSN)
- **When:** prod required; dev no-ops if blank
- **Why:** error capture and source-map symbolication. The auth token
  uploads source maps; the DSNs route events.

### Alert-rules setup — `SENTRY_ALERTS_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG`, `SENTRY_BASE_URL`, `SENTRY_ENVIRONMENT`, `SENTRY_SLACK_*`
- **Where:** `scripts/setup-sentry-alerts.mjs` (run manually after
  Sentry org changes)
- **When:** as-needed; not part of the normal deploy
- **Why:** programmatically reconciles the Sentry alert rules. The
  Slack vars wire delivery into the workspace integration. EU-region
  orgs need `SENTRY_BASE_URL=https://de.sentry.io`.

---

## Email (Resend)

### `RESEND_API_KEY`
- **Where:** Worker (every transactional email)
- **When:** prod required; dev falls back to Resend's sandbox sender
- **Why:** authenticates outbound mail.

### `EMAIL_FROM`
- **Where:** Worker (`From` header)
- **When:** prod required (`lib/email.ts` refuses to send when unset);
  dev defaults to `Cavaliq <onboarding@resend.dev>` (Resend sandbox)
- **Why:** must be a verified domain in prod (`no-reply@cavaliq.com`)
  or Resend rejects the send.

---

## Cron + Webhooks

### `CRON_SECRET`
- **Where:** Worker (`/api/cron/livery-billing`,
  `/api/cron/platform-billing`, etc.)
- **When:** prod required (cron routes 503 without it)
- **Why:** shared secret the OpenNext `scheduled()` wrapper sends as
  `x-cron-secret` on its daily 02:00 UTC ping. Without it, anyone with
  the public route URL could trigger billing. Generate with
  `openssl rand -hex 32`.

### `WEBHOOK_STALE_AFTER_MS`
- **Where:** Worker (webhook claim-recovery in
  `packages/db/src/queries/webhook-events.ts`)
- **When:** optional; default 300000 (5 min)
- **Why:** how long a `received` claim is trusted before another worker
  can re-claim. Too short → double-processing risk on slow workers;
  too long → events stuck after a genuine crash.

---

## Rate-limiting (Upstash Redis)

### `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Where:** Worker (`lib/rate-limit.ts`)
- **When:** prod required for effective cross-instance throttling; dev
  falls back to per-instance in-memory
- **Why:** without Upstash, rate limits don't compose across the
  geographically-distributed Workers fleet — a flooder hitting two
  edge nodes gets twice the budget.

---

## Encryption

### `ENCRYPTION_KEY`
- **Where:** Worker (`lib/crypto.ts`)
- **When:** required in dev and prod (must decode to exactly 32 bytes:
  64 hex chars or 44 base64 chars). Audit F-62 (2026-05-07 r5): the
  `assertEncryptionKeyConfigured` boot probe is enforced at request
  time, NOT at instrumentation startup — leaving this unset locally
  doesn't crash the dev server, but the first request that touches
  encrypted-at-rest data (opening a horse health tab, creating a
  medication, paying a booking, viewing rider medical notes) will
  throw with a misleading "secret not configured" error. **Set this
  for local dev whenever you're working on health, payments, or
  rider-profile features**, even if you don't strictly need it for
  the rest of the surface. Generate with `openssl rand -hex 32`.
- **Why:** AES-256-GCM key for field-level encryption of payment
  credentials, rider medical notes, and other sensitive columns
  (`v1:` versioned ciphertext). Rotate via the runbook in
  INCIDENT_RUNBOOK.md.

---

## Mobile (Expo)

### `EXPO_PUBLIC_API_URL`
- **Where:** mobile bundle (statically inlined at Expo build time)
- **When:** prod required (`apps/mobile/lib/api.ts` throws at startup
  if unset in non-dev); dev defaults to localhost
- **Why:** the app's API target. Expo bundles this at build time, so
  staging vs prod requires separate builds.

### `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- **Where:** mobile bundle
- **When:** required in dev and prod
- **Why:** mobile auth — must match the `pk_…` mode of the web app
  (live or test).

---

## CI-only

### `CLOUDFLARE_API_TOKEN`
- **Where:** GitHub Actions deploy workflow, or a gitignored local env
  file when running `wrangler` manually
- **When:** required for automated or local production deploys; not read
  by the Worker runtime
- **Why:** authenticates Cloudflare deploy automation. Scope it to the
  deployed Worker only and keep the real value out of committed files.

### `NEON_PROJECT_ID`
- **Where:** GitHub Actions (`scripts/test-neon-smoke.mjs`)
- **When:** CI only — local runs derive the project from `DATABASE_URL`
- **Why:** documents the project the smoke job runs against; keep the
  `.env.example` line for parity with CI.

### `NEON_API_KEY`
- **Where:** GitHub Actions secret only
- **When:** required for the CI smoke job
- **Why:** authenticates the Neon API for branch creation in tests.
  Never stored in repo files.

---

## What lives where (cheat sheet)

| Var | dev (.env.local) | prod (Worker secret) | CI (GH Actions) | Build (`cf:build`) |
| --- | --- | --- | --- | --- |
| Clerk pub/secret | ✓ | ✓ | ✓ (test mode) | — |
| `DATABASE_URL` | ✓ | ✓ | ✓ | ✓ (stub OK) |
| R2 keys | ✓ if testing uploads | ✓ | — | — |
| `PLATFORM_ZIINA_*` | optional | ✓ | — | — |
| `RESEND_API_KEY` | optional | ✓ | — | — |
| `CRON_SECRET` | optional | ✓ | — | — |
| `ENCRYPTION_KEY` | ✓ | ✓ | ✓ | — |
| `EXPO_PUBLIC_*` | ✓ for mobile dev | — (mobile-only) | ✓ for mobile build | — |
| Sentry build-time | optional | — | ✓ | ✓ |

When in doubt: if it's prefixed `NEXT_PUBLIC_` or `EXPO_PUBLIC_` it's
embedded into the client bundle and is **not** a secret. Everything
else is a server secret — set via `wrangler secret put` in prod.
