# Deploy Runbook — Cavaliq on Cloudflare Workers

Everything below is a one-time setup plus a repeatable deploy loop. Do the
one-time steps once per environment (staging, production), then the deploy
loop is `pnpm cf:deploy` from `apps/web`.

Infrastructure: Cloudflare Workers (via OpenNext adapter) for the Next.js
app, Neon for Postgres, Upstash for rate-limit Redis, R2 for file storage,
Clerk for auth, Stripe / N-Genius / Ziina for payments, Resend for email,
Sentry for error tracking.

---

## One-time: Cloudflare account + domain binding

1. **Log in with Wrangler** (once per machine):
   ```sh
   pnpm --filter @equestrian/web exec wrangler login
   ```
2. **Add `cavaliq.com` as a Cloudflare zone** (if it isn't already). Done in
   the Cloudflare dashboard: *Websites → Add a Site*. Point your registrar's
   nameservers at Cloudflare when prompted.
3. **Route binding**: `wrangler.jsonc` already lists `cavaliq.com` and
   `www.cavaliq.com` as custom domains. On first deploy, Cloudflare will
   provision the TLS cert automatically and add the DNS record for you.

## One-time: secrets

Run these from `apps/web/` after `wrangler login`. Each prompts for a value —
paste and hit enter. They're stored encrypted on Cloudflare's side.

```sh
# Database (Neon — use the pooled URL for DATABASE_URL, unpooled for migrations)
wrangler secret put DATABASE_URL
wrangler secret put DATABASE_URL_UNPOOLED

# Clerk
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_WEBHOOK_SECRET
wrangler secret put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# Stripe
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_CLIENT_ID          # OAuth client id from Stripe Connect settings
wrangler secret put NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# R2 (S3-compatible)
wrangler secret put R2_ENDPOINT
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_BUCKET_NAME
wrangler secret put R2_PUBLIC_URL

# Upstash Redis (rate limiting)
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN

# Resend (email)
wrangler secret put RESEND_API_KEY

# Default From address for transactional email — must be a verified Resend
# sender. lib/email refuses to send in production when this is unset (the
# previous fallback to onboarding@resend.dev silently spam-trapped Gmail).
# Format: `Cavaliq <hello@cavaliq.com>`.
wrangler secret put EMAIL_FROM

# Sentry (error tracking)
wrangler secret put SENTRY_DSN
wrangler secret put NEXT_PUBLIC_SENTRY_DSN

# Daily livery-billing cron secret (REQUIRED — without it the cron route
# 503s every fire). worker-entry.mjs sends this header when invoking the
# scheduled handler at 02:00 UTC. Generate with: openssl rand -hex 32.
wrangler secret put CRON_SECRET

# Encryption key for horse medical data
# Generate with: openssl rand -hex 32
wrangler secret put ENCRYPTION_KEY
```

**What's NOT a secret** (already in `wrangler.jsonc` under `vars`):
`NODE_ENV`, `NEXT_PUBLIC_APP_URL`, `CORS_ALLOWED_ORIGINS`,
`N_GENIUS_API_BASE_URL`, `ZIINA_API_BASE_URL`.

## One-time: run database migrations

Migrations live in `packages/db/migrations/`. Point Drizzle at the Neon
**unpooled** URL — pooled connections reject DDL.

```sh
cd packages/db
export DATABASE_URL_UNPOOLED="postgresql://<user>:<pass>@<host>/<db>?sslmode=require"
pnpm db:migrate
```

This applies every migration listed in `meta/_journal.json` — currently
through `0014_booking_refunded_amount`. After it completes, spot-check
via `pnpm db:studio`: `bookings` should have `payment_provider`,
`provider_payment_id`, `refunded_amount_minor`; `webhook_events` should
have `status`, `attempt_count`, `last_attempted_at`, `last_error`.

For schema changes on subsequent deploys, see **Migration gate** under
the deploy loop below — that's the routine, not this one-time section.

## One-time: external provider configuration

### Clerk
In the Clerk dashboard:
1. **Allowed origins**: add `https://cavaliq.com` and `https://www.cavaliq.com`.
2. **Webhook endpoint**: `https://cavaliq.com/api/webhooks/clerk` — subscribe
   to `organization.created/updated/deleted`, `organizationMembership.created/updated/deleted`.
   Copy the signing secret → set it as `CLERK_WEBHOOK_SECRET`.

### Stripe Connect
In the Stripe dashboard (Platform → Connect → Settings):
1. **OAuth redirect URI**: add `https://cavaliq.com/api/v1/payments/stripe/callback`.
2. **Platform webhook endpoint**: `https://cavaliq.com/api/webhooks/stripe` —
   subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `charge.refunded`, `charge.refund.updated`.
   Copy the signing secret → set it as `STRIPE_WEBHOOK_SECRET`.
3. **Client id**: Developers → API keys → Connect → copy the `ca_…` value →
   set it as `STRIPE_CLIENT_ID`.

### N-Genius
In the Network International merchant portal (per club, not platform-wide):
1. **Webhook URL**: `https://cavaliq.com/api/webhooks/n-genius`.
2. **Custom header**: pick a name like `X-Webhook-Token` and a long random
   value — the club enters both when they connect N-Genius in our settings.
   Network International reviews/whitelists the URL before activating.

### Ziina
In the Ziina business dashboard (per club):
1. **Webhook URL**: `https://cavaliq.com/api/webhooks/ziina/<clubId>` — the
   per-club path is deliberate, since Ziina payloads don't carry a merchant
   id. The club's `clubId` is visible in the Cavaliq URL when they're
   logged into the dashboard.
2. **Signing secret**: Ziina will generate one — the club pastes it into the
   connect form.

### Sentry (source maps)
Set these as **build-time** env vars (in GitHub Actions / CI, not in
`wrangler.jsonc`):

```
SENTRY_ORG=<your-sentry-slug>
SENTRY_PROJECT=cavaliq-web
SENTRY_AUTH_TOKEN=<from sentry.io/settings/auth-tokens>
```

Without these, the build still succeeds but production stack traces stay
minified.

### CI secrets (GitHub Actions)

The CI workflow (`.github/workflows/ci.yml`) has two jobs that need
external credentials:

**Sentry alert-rules sync** (only if you wire it into CI later — by
default the script runs locally via `pnpm sentry:alerts`):
- `SENTRY_ALERTS_AUTH_TOKEN` — user token, scopes `alerts:write` +
  `project:read`. Generate at *Settings → Account → API → Auth Tokens*.

**Neon test-branch smoke job** (runs on every PR + main push):
- Repository **secret** `NEON_API_KEY` — generate at
  *console.neon.tech → Account settings → API keys*. Scope: full
  account access.
- Repository **variable** `NEON_PROJECT_ID` — visible in your Neon
  project URL (e.g. `crimson-flower-12345678`). Use a *variable*, not
  a *secret* — secrets are masked from logs and the create-branch
  action prints the project id during normal output.

Without these, the `neon-smoke` job will fail on the create-branch
step with a missing-credentials error. PRs from forks skip the job
entirely (the `if:` guard in the workflow).

---

## Deploy loop

From `apps/web/`:

```sh
# Preview locally against the production wrangler config (Workers local runtime)
pnpm cf:preview

# Deploy to cavaliq.com
pnpm cf:deploy
```

The first deploy will take ~2 minutes while Cloudflare provisions the TLS
cert for `cavaliq.com`. Subsequent deploys are <30s.

### Migration gate (do this BEFORE `cf:deploy`)

If the branch you're deploying contains any new files under
`packages/db/migrations/` (or any schema change in
`packages/db/src/schema/`), **apply the migrations first**:

```sh
cd packages/db
# DATABASE_URL_UNPOOLED must point at the Neon unpooled endpoint — pooled
# connections reject DDL. Safe to re-run; migrations are idempotent.
export DATABASE_URL_UNPOOLED="postgresql://<user>:<pass>@<host>/<db>?sslmode=require"
pnpm db:migrate
```

Why the order matters: the deployed code often references columns the
migration just added. Deploying first means the first request after
rollout hits a column-not-found error. Migrating first is always safe —
old code tolerates extra columns just fine.

A quick check to run before you deploy:

```sh
# Every tag in meta/_journal.json should also exist as a .sql file, AND
# every .sql file you added should be referenced in the journal.
ls packages/db/migrations/*.sql | sed -E 's|.*/||; s|\.sql$||'
jq -r '.entries[].tag' packages/db/migrations/meta/_journal.json
```

### Regenerating the Cloudflare env type

When you add a new binding to `wrangler.jsonc`, regenerate the `CloudflareEnv`
type so TypeScript knows about it:

```sh
pnpm --filter @equestrian/web cf:typegen
```

---

## Smoke-test checklist

Work through this the first time you hit `cavaliq.com` after a production
deploy. Each step verifies a different subsystem.

1. **[ ] Auth**: sign up a fresh account via Clerk, get redirected to
   `/select-org` → create a club → land on `/onboarding`.
2. **[ ] Onboarding**: complete club basics → add an arena → add a lesson
   type → connect a payment provider (Stripe OAuth OR paste an N-Genius /
   Ziina sandbox key) → invite a staff member via email → finish.
3. **[ ] RLS**: open Drizzle Studio against prod, try to `SELECT * FROM horses`
   without `SET app.current_club_id` — should return zero rows. Then set
   the var and rerun — should see the club's horses.
4. **[ ] Horse create**: dashboard → Horses → Add Horse → fill out fields
   including a medical note in the health tab. In DB: `diagnosis` column
   should start with `v1:` (AES-GCM ciphertext).
5. **[ ] Booking + payment (Stripe test)**: dashboard → Calendar → add slot
   → sign in as a rider (separate Clerk user) → /rider/book → confirm a
   slot → on the rider booking page, payment dialog opens → pay with test
   card `4242 4242 4242 4242`, any CVC/exp → status transitions to `paid`
   within a few seconds.
6. **[ ] Booking + payment (N-Genius / Ziina sandbox)**: same flow — the
   pay dialog shows "Continue to payment" → redirects out → pay on the
   provider's sandbox page → returns to `/rider/bookings/<id>?from=payment`
   → polls until webhook lands → status `paid`.
7. **[ ] Refund**: manually trigger a refund from the Stripe dashboard for
   the test booking → webhook should flip `payment_status` to `refunded`.
8. **[ ] Rate limiting**: from the browser devtools, hit
   `/api/v1/bookings?pageSize=1` 120 times in 60 seconds — request 61+
   should return `429 RATE_LIMITED`. Confirms Upstash is live.
9. **[ ] Sentry**: in dev tools console, run
   `fetch('/api/v1/nonexistent-route-to-trigger-404')` — shouldn't log to
   Sentry (404s are normal). Then deliberately break a query and confirm
   it surfaces under the project in Sentry.
10. **[ ] Mobile payment**: TestFlight / Expo dev build → sign in as rider →
    book a slot → payment page opens in SFSafariViewController →
    complete payment → browser closes → home screen shows the paid
    booking.

---

## Rollback

If the latest deploy is broken:

```sh
# List recent deployments
wrangler deployments list

# Roll back to a specific deployment id (shown in `list`)
wrangler rollback <deployment-id>
```

Worker rollback is instant — no rebuild required.

---

## Known caveats to keep in mind

- **Sentry `onRequestError` on Cloudflare**: wrapped in try/catch because of
  [getsentry/sentry-javascript#18842](https://github.com/getsentry/sentry-javascript/issues/18842).
  If Sentry stops receiving server-side errors, that's the suspect.
- **Neon + Workers**: we use the WebSocket driver for transactions. Workers
  have native WebSocket, so the `ws` polyfill is skipped at runtime (see
  `packages/db/src/index.ts`).
- **Rate limiting fail-open**: if Upstash is briefly unreachable, we fall
  back to per-instance in-memory counting rather than block all traffic.
  Intentional — flip in `lib/rate-limit.ts` if you want fail-closed.
- **N-Genius webhook whitelisting**: Network International reviews every
  webhook URL before it starts delivering. Expect a day or two of lag
  when switching environments.
- **Ziina per-club webhook URL**: each club has to register
  `https://cavaliq.com/api/webhooks/ziina/<clubId>` themselves via Ziina's
  `POST /webhook` API. Not automated yet — document it in the connect flow
  or wire a helper that calls Ziina on their behalf during connect.

---

## Environments

Today there's only the `production` environment (Cavaliq's main domain).
When you want a staging environment, duplicate the `wrangler.jsonc` block
under `env.staging` with:
- a staging worker name (e.g. `cavaliq-staging`)
- routes pointing at `staging.cavaliq.com`
- `NEXT_PUBLIC_APP_URL=https://staging.cavaliq.com`
- the `-staging` / `test` versions of every secret

Deploy via `pnpm --filter @equestrian/web exec wrangler deploy --env staging`.

---

## Backup + restore (Neon Postgres)

Cavaliq's authoritative data — bookings, payment ledger, audit log, encrypted
horse medical records — lives entirely in Neon. **Verify retention before
relying on it**: Neon's free + Pro tiers come with a 7-day branch retention
default; the Scale tier extends it. Confirm via the Neon console:

```
Settings → Project settings → "Branch retention period"
```

### Point-in-time restore

Neon stores WAL for the retention window, so any timestamp in that range
can be restored as a fresh branch. Useful for recovering from a botched
migration / accidental DELETE.

```sh
# Install neonctl once (per machine)
npm install -g neonctl

# Authenticate
neonctl auth

# Create a recovery branch from a specific moment
neonctl branches create \
  --project-id <NEON_PROJECT_ID> \
  --name recovery-2026-04-26-15h \
  --parent main \
  --timestamp 2026-04-26T15:00:00Z

# Print its connection string (use the unpooled one for read-only diagnosis)
neonctl connection-string recovery-2026-04-26-15h --pooled false
```

Connect to the recovery branch via `psql` or Drizzle Studio and verify the
data matches expectations. The recovery branch is a full read/write copy,
so SELECTs work without setting `app.current_club_id` (we dropped RLS in
migration 0011).

### Promotion (only after smoke testing the recovery branch)

```sh
# Make the recovery branch the new primary. THIS IS DESTRUCTIVE — the
# current `main` becomes a sibling branch, not gone, but every running
# Worker will start writing against the new primary on its next query.
neonctl branches set-primary recovery-2026-04-26-15h
```

After promoting, run the standard smoke-test checklist above against the
new primary BEFORE telling customers the system is back online. Common
gotchas: deleted rows that were referenced by FKs in still-active rows
will fail to insert; check for orphaned references with
`packages/db/src/test/cross-tenant-binding.test.ts`'s spirit (run a few
spot SELECTs).

### Last tested

Document the date you last actually performed a restore. Untested backups
are not backups.

A self-contained drill script lives at `scripts/restore-drill.mjs` —
mint a Neon API key, then:

```sh
NEON_API_KEY=neon_... NEON_PROJECT_ID=sweet-boat-90778968 \
  pnpm restore:drill
# Restore further back (default is 1h):
PITR_HOURS_AGO=24 NEON_API_KEY=... NEON_PROJECT_ID=... pnpm restore:drill
```

The script creates a PITR branch, runs sanity queries (`_migrations`,
`clubs`, `bookings` row counts), tears the branch down, and prints the
target time on success. NEON_API_KEY is intentionally not stored —
mint a scoped one at console.neon.tech → Account → API.

> Last restore drill: **TODO** — run `pnpm restore:drill` within the
> first quarter of operation and update this line with the date.

---

## CI / branch protection (DONE — audit H-3)

Active rule on `main` as of audit closeout:

- `required_status_checks.strict = true` with both contexts:
  - `typecheck · lint · test`
  - `neon test branch · smoke`
- `enforce_admins = true`
- `allow_force_pushes = false`
- `allow_deletions = false`

`required_pull_request_reviews` is intentionally NOT set — one-founder
shop. Re-add when there's a second engineer.

To inspect or modify:

```sh
gh api /repos/17Abrar/equestrian-app/branches/main/protection
gh api -X PUT /repos/17Abrar/equestrian-app/branches/main/protection --input <body.json>
```

---

## Deploy automation (workflow committed — needs API-token secret)

`.github/workflows/deploy.yml` runs on `workflow_run` after CI passes
on main, applies pending Neon migrations, then deploys via
`cloudflare/wrangler-action@v3`. Concurrency-locked so two pushes
queue rather than collide.

Required secrets (set with `gh secret set`):

- `CLOUDFLARE_ACCOUNT_ID` ✓ already set (`343dc071...`)
- `CLOUDFLARE_API_TOKEN` ✗ **TODO (dashboard-only)** — mint at
  https://dash.cloudflare.com/profile/api-tokens with **Workers Scripts:Edit
  + Account Logs:Edit + Workers R2 Storage:Edit + Account Settings:Read**.
  The wrangler OAuth token doesn't expose the API-token-mint scope, so
  this is the one item that must be done in the Cloudflare dashboard.
  Once minted: `gh secret set CLOUDFLARE_API_TOKEN`.
- `DATABASE_URL_UNPOOLED` ✓ set 2026-04-27 (Neon prod unpooled URL,
  used by `db:migrate:neon` in deploy.yml).
- `SENTRY_AUTH_TOKEN` ✓ set 2026-04-27 (optional — enables source-map
  upload for production stack traces).

Status: every step in the workflow is verified against main except
the final `wrangler deploy` (it's the only one that needs
`CLOUDFLARE_API_TOKEN`). Once the token lands, the next push auto-
deploys end-to-end. Until then, fall back to manual `pnpm cf:deploy`
from a clean main checkout — the same command the deploy step uses.

---

## Sentry alerts (workflow committed)

`.github/workflows/sentry-alerts.yml` triggers on push-to-main when
`OBSERVABILITY.md` or `scripts/setup-sentry-alerts.mjs` changes, plus
manual dispatch. Required repo secrets (already set per the audit
prep):

- `SENTRY_ALERTS_AUTH_TOKEN` ✓
- `SENTRY_ORG_SLUG` / `SENTRY_PROJECT_SLUG` / `SENTRY_BASE_URL` —
  repo *variables*.

Optional Slack delivery — install the Sentry → Slack integration in
Sentry's UI, then set repo variables:

- `SENTRY_SLACK_WORKSPACE`
- `SENTRY_SLACK_CHANNEL_WARN`
- `SENTRY_SLACK_CHANNEL_CRIT`

Without these, alerts fall back to email-only. Audit H-11.

---

## Cloudflare Logpush (R2 bucket created — needs API-token to wire)

R2 bucket `cavaliq-logs` is provisioned (`wrangler r2 bucket list`
confirms it). The Logpush job needs an API token with
`Account Logs:Edit`:

```sh
# Mint at https://dash.cloudflare.com/profile/api-tokens, then:
ACCOUNT_ID=343dc071ad865a59094c44c79be38ccc
CF_API_TOKEN=<your-token>

curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "cavaliq-workers-trace-events",
    "destination_conf": "r2://cavaliq-logs/{DATE}/{HH}?account-id='"$ACCOUNT_ID"'&access-key-id=<R2_ACCESS_KEY>&secret-access-key=<R2_SECRET>",
    "dataset": "workers_trace_events",
    "enabled": true,
    "filter": "{\"where\":{\"key\":\"ScriptName\",\"operator\":\"eq\",\"value\":\"cavaliq\"}}",
    "output_options": {
      "field_names": ["EventTimestampMs", "Outcome", "ScriptName", "Logs", "Exceptions"]
    }
  }'
```

Document the resulting job id in this section after creation. Audit H-17.
