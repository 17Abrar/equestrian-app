# Incident Runbook

Audit H-22. Lives next to `DEPLOY.md` so on-call has a single mental
model for "production isn't working." Update the on-call line, the
status-page link, and the customer-comms template the moment any of
them changes.

## On-call

- **Primary**: founder (abrarabusreyel@gmail.com / phone on
  PagerDuty profile)
- **Hours**: 24/7 (one-founder shop until first hire)
- **Escalation if unreachable**: there's no escalation today. Customer
  expectation is that critical incidents get a written acknowledgement
  within 60 minutes via the status page; remediation may take longer.

## First 15 minutes — triage flow

1. **Check the Sentry alert** that paged. The `logger.event` tag tells
   you which subsystem fired (e.g. `livery_cron_failed`,
   `webhook_permanently_failed`, `email_send_failed`). The exception
   message + stack trace narrows further.
2. **Check upstream status**:
   - Cloudflare Workers / R2 — https://www.cloudflarestatus.com/
   - Neon Postgres — https://neonstatus.com/
   - Stripe — https://status.stripe.com/
   - Clerk — https://status.clerk.com/
   - Resend — https://resend.com/status
   - Upstash — https://status.upstash.com/
   If any are red, attach the linked incident to the customer-comms
   draft and skip to "Customer comms" below — there is nothing to fix
   on our side until upstream recovers.
3. **Run the deep health probe**:
   `curl https://cavaliq.com/api/v1/health?deep=1`
   Returns 200 with per-subsystem status when all green; 503 with the
   specific subsystem flagged otherwise.
4. **If a recent deploy is suspect**:
   `pnpm --filter @equestrian/web exec wrangler deployments list`
   `pnpm --filter @equestrian/web exec wrangler rollback`
   Rollback first, investigate after — preserve evidence in the
   logs but get production back to known-good.

## Common scenarios

### Cron silently stopped firing

Symptoms: no `livery_cron_completed` log line in the last 24h.

1. Check `worker-entry.mjs` scheduled handler logs in Cloudflare's
   tail viewer for `cron_scheduled_failed` or `cron_scheduled_non_ok`.
2. Verify `CRON_SECRET` is set:
   `pnpm --filter @equestrian/web exec wrangler secret list`
3. Manually fire the cron once:
   `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://cavaliq.com/api/cron/livery-billing`
   Inspect the response body for the per-club summary. If the route
   500s, the next subsection applies.

### Cron run threw

Symptoms: `livery_cron_failed` log fired with an error message.

1. Check the Sentry exception for the failing query. Most common
   causes: a Neon outage (transient — retry next day), a schema
   drift between code and DB (deploy missed a migration — apply
   manually), or a malformed row that the cron's bounded SELECTs
   didn't filter out.
2. The cron's per-iteration catches mean a single bad row doesn't
   poison the whole run. If only one club is affected, isolate via
   the `clubId` field in the exception.

### Webhooks aren't being processed

Symptoms: payments captured at the provider but not reflected on
bookings; `webhook_no_club_resolved` or `webhook_permanently_failed`
log lines.

1. Verify the provider's webhook endpoint is still configured —
   Stripe / Ziina / N-Genius dashboards. Stripe specifically: rotate
   the webhook signing secret if it was leaked, then update
   `STRIPE_WEBHOOK_SECRET` in wrangler.
2. Check `webhook_events` table for the affected provider:
   `SELECT status, count(*) FROM webhook_events
    WHERE provider = 'stripe' AND last_attempted_at > now() - interval '1 hour'
    GROUP BY status`
   Many `permanently_failed` rows mean the org-not-found race is
   stuck — usually a Clerk org delete that didn't propagate cleanly.
3. To replay a single event manually, the provider's dashboard has
   a "Resend" button (Stripe), or rerun the cron's reconcile path.

### Customer reports they were charged but their booking shows unpaid

1. Look up the booking — `getBookingById(clubId, bookingId)`. If
   `payment_status` is still `pending` but they have a Stripe charge
   on their bank statement, this is a webhook delivery failure.
2. Check Stripe Dashboard → Events for the matching
   `payment_intent.succeeded`. If "Failed" — replay it. If "Sent" —
   look in `webhook_events` for the matching `event.id`; check status.
3. Manual remediation: mark the booking paid via the rider portal /
   admin payment endpoint OR refund the rider via Stripe and ask
   them to re-book.

## Customer comms

When an incident is customer-visible (any deep-probe subsystem 503,
any payment-flow outage, any sustained webhook lag > 15 minutes),
post within 30 minutes:

```
Hi everyone,

We're experiencing degraded service on Cavaliq. Specifically,
[booking creation / payment / login] is currently affected.

[If upstream] This is tied to an ongoing incident at
[Cloudflare/Neon/Stripe/Clerk] — see [link].

[If our side] Our team is investigating; we expect to have an
update within the hour.

Bookings already in your calendar are not affected. We'll
post here when service is fully restored.

— Cavaliq team
```

**Status page**: https://status.cavaliq.com (TODO — when set up,
this is a Cloudflare Pages project hosting a static markdown page;
update via PR. Until that exists, post the same comms to JSR's
WhatsApp group + cavaliq.com homepage banner.)

## Postmortem

Within 5 business days of any incident that hit a customer:

1. Open a doc titled `Postmortem-YYYY-MM-DD-{slug}.md` in the
   `docs/incidents/` folder (create the folder if missing).
2. Sections: Summary, Timeline (UTC), Root cause, What worked, What
   didn't, Action items (with owners + dates).
3. Link the postmortem from this runbook's "Past incidents" section
   below.

## Past incidents

(Empty as of audit closeout 2026-04-26. Append entries newest-first.)
