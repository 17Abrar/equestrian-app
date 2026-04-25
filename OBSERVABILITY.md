# Observability — Sentry alert rules

Cavaliq forwards structured logs (via `lib/logger.ts`) and unhandled
exceptions to Sentry. The app is configured in `sentry.server.config.ts`,
`sentry.edge.config.ts`, and `instrumentation-client.ts` with a 10% trace
sample and PII scrubbing in `beforeSend`.

Every `logger.warn(...)` / `logger.error(...)` call lands in Sentry as
an issue with a `logger.event` tag set to the log name (e.g.
`logger.event = stripe_webhook_processing_failed`). **All alert rules
filter on that tag** — never on message text. Tag-based matching
survives log-message wording changes; message-text matching breaks
silently when a copy edit lands.

`scripts/setup-sentry-alerts.ts` creates every rule in the tables below
via Sentry's REST API. Run it once after editing this file:

```sh
SENTRY_AUTH_TOKEN=... SENTRY_ORG_SLUG=... SENTRY_PROJECT_SLUG=cavaliq-web \
  pnpm tsx scripts/setup-sentry-alerts.ts
```

The script is idempotent — it lists existing rules and only creates
missing ones (matched by name). The integrations (PagerDuty, Slack)
must already exist in *Settings → Integrations* before the rule's
action will resolve.

## Why this matters

Before the 2026-04 audit sweep, `stripe_webhook_processing_failed` etc.
were logged at ERROR but had no alert routing. A Neon blip that dropped
an event would sit in logs and no one would see it until a rider
complained days later. These alerts turn those silent failures into
pages.

## Critical — page immediately

These indicate a user-visible loss of money, data, or payment state.
Route to on-call (PagerDuty → phone).

| Event (log name) | Threshold | Why |
|---|---|---|
| `stripe_webhook_processing_failed` | `> 0 events / 5 min` | A Stripe webhook threw and we returned 5xx. Stripe retries, but a pattern here means booking/refund state is drifting from provider state. |
| `n_genius_webhook_processing_failed` | `> 0 events / 5 min` | Same as Stripe, for N-Genius. |
| `ziina_webhook_processing_failed` | `> 0 events / 5 min` | Same as Stripe, for Ziina. |
| `livery_invoice_issue_failed` | `> 0 events / 5 min` | Cron tried to issue an invoice and threw. Invoice may or may not have been created — a sustained trickle means the billing cadence is broken. |
| `webhook_no_club_resolved` | `> 3 events / 5 min` | Either a misconfigured webhook or a hostile signed event. 1-2 can be test-mode noise; a sustained rate warrants investigation. |
| `booking_refund_ledger_conflict` | `> 0 events / hour` | Provider refunded the money but our ledger failed to record. Means two admins clicked refund at the same time — rare enough that any occurrence warrants a manual reconcile against the provider dashboard. |
| `stripe_oauth_state_invalid` | `> 5 events / 5 min` | Could be users bouncing back from expired Stripe consent, or an attacker fuzzing the callback. Spike → investigate. |
| `livery_cron_bad_secret` | `> 0 events / 5 min` | Someone is hitting the livery-billing cron with the wrong / missing `x-cron-secret`. Could be a stale Cloudflare scheduled trigger from a previous deploy, internet noise, or active fuzzing. Investigate the IP from the log payload before assuming it's benign. |

## Warning — investigate next business day

Signals of degraded health but not user-visible outages. Route to Slack.

| Event (log name) | Threshold | Why |
|---|---|---|
| `stripe_webhook_in_flight` | `> 10 events / 5 min` | Two workers processing the same event concurrently. At this rate, something is re-delivering faster than we're finishing. |
| `webhook_no_booking_for_event` | `> 10 events / 5 min` | Either unmapped external payments or a TOCTOU we thought was fixed (see `webhook-helpers.ts` fallback). Worth periodic review. |
| `rate_limit_exceeded` | `> 50 events / 5 min, same userId` | One user is hammering the API. Could be a script, a runaway client, or a scrape. |
| `upload_magic_byte_mismatch` | `> 3 events / hour, same clubId` | Someone in the club is trying to upload non-image content as an image. Usually benign (iOS HEIC, WebP under the wrong MIME), but a sustained rate on one account is suspicious. |
| `booking_refund_provider_error` | `> 3 events / hour` | Provider rejecting our refund calls. Not user-initiated failure — indicates we're calling the API wrong or account is in a bad state. |
| `email_send_failed` | `> 5 events / 5 min` | Resend refusing our sends. Bounces, domain misconfig, or quota. |
| `livery_payment_intent_failed` | `> 5 events / hour` | Livery cron can't create a pay intent for an invoice. Invoice ships without a pay link, rider has to pay off-platform. |
| `webhook_preserving_partial_refund_status` | Informational only — graph for context | Confirms the partial-refund status machine is firing correctly. No alert; useful to see the frequency. |

## Severity — investigate if trend is unusual

Common enough to not page on, but worth watching on the dashboard.

| Event | Why track |
|---|---|
| `audit_log_failed` | Audit writes are best-effort; a failure is non-blocking but means we're losing a record. |
| `booking_confirmation_email_failed` | One rider didn't get a receipt. Should stay near zero. |
| `n_genius_webhook_outlet_not_recognized` | Leftover deliveries for disconnected clubs — should drop to zero a few hours after disconnect. |

## Alert rule template (Sentry)

If you're creating rules by hand instead of running the setup script,
use this template at *Project → Alerts → Create Alert Rule → Issues*:

- **Filter**: an issue's `logger.event` tag **equals** the event name
  (e.g. `stripe_webhook_processing_failed`). DO NOT use "message
  contains" — log message text drifts; the tag doesn't.
- **When condition**: number of events / time window (per table above).
- **Action**: Slack channel for warnings, PagerDuty for critical.
- **Environment**: `production` only — staging + dev will spam.
- **Frequency**: suppress re-alerts for 30 minutes unless the condition worsens.

## Also check

- **Error rate overview** — Performance → Transactions → sort by error rate. Any new endpoint with > 5% error rate is noteworthy.
- **Web vitals** — Performance → Web Vitals. LCP > 2.5s on `/(dashboard)/calendar` pages is the first signal that the calendar query needs pagination.
- **Replay sampling** — enable session replays for errored sessions in production; they're the fastest way to diagnose a one-off user complaint.
