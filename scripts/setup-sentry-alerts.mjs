#!/usr/bin/env node
/**
 * Idempotent Sentry alert-rules setup.
 *
 * Reads the alert table embedded below (mirror of OBSERVABILITY.md) and
 * creates one Issue Alert Rule per row in your Sentry project. Each
 * rule filters on the `logger.event` tag — matching the tag that
 * `lib/logger.ts` stamps on every structured `logger.warn` /
 * `logger.error` call. Tag-based matching is intentional: log message
 * text drifts as the codebase evolves; the tag does not.
 *
 * Idempotency: lists existing rules and skips any whose `name` already
 * exists, so re-running the script is safe.
 *
 * Run from the repo root:
 *
 *   pnpm sentry:alerts
 *
 * The pnpm script wraps `node --env-file=.env.local`, so it picks up the
 * SENTRY_* values stored there automatically. Required env:
 *
 *   SENTRY_ALERTS_AUTH_TOKEN  user token with `alerts:write` + `project:read`
 *                              (or fall back to SENTRY_AUTH_TOKEN if that's
 *                              what you have)
 *   SENTRY_ORG_SLUG           e.g. cavaliq
 *   SENTRY_PROJECT_SLUG       e.g. javascript-nextjs
 *
 * Optional env:
 *   SENTRY_BASE_URL          default https://sentry.io. EU-region orgs
 *                              must set https://de.sentry.io.
 *   SENTRY_ENVIRONMENT       default production
 *   SENTRY_SLACK_WORKSPACE   numeric Sentry-Slack integration id; when
 *                            set, Slack action is attached to all rules
 *   SENTRY_SLACK_CHANNEL_WARN  e.g. #cavaliq-warn (warnings)
 *   SENTRY_SLACK_CHANNEL_CRIT  e.g. #cavaliq-pager (criticals)
 *   DRY_RUN=1                print payloads, don't POST
 *
 * If the script reports "skipped (already exists)", the rule is in
 * Sentry — but it may have been created with the old `message
 * contains` filter. Delete those by hand in the dashboard, then re-run.
 */

const TOKEN = process.env.SENTRY_ALERTS_AUTH_TOKEN ?? process.env.SENTRY_AUTH_TOKEN;
if (!TOKEN) {
  console.error('error: set SENTRY_ALERTS_AUTH_TOKEN (or SENTRY_AUTH_TOKEN as fallback).');
  process.exit(1);
}
const REQUIRED_ENV = ['SENTRY_ORG_SLUG', 'SENTRY_PROJECT_SLUG'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`error: ${key} is required.`);
    process.exit(1);
  }
}

const SENTRY_BASE = process.env.SENTRY_BASE_URL ?? 'https://sentry.io';
const ORG = process.env.SENTRY_ORG_SLUG;
const PROJECT = process.env.SENTRY_PROJECT_SLUG;
const ENV = process.env.SENTRY_ENVIRONMENT ?? 'production';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const SLACK_WORKSPACE = process.env.SENTRY_SLACK_WORKSPACE;
const SLACK_CHANNEL_WARN = process.env.SENTRY_SLACK_CHANNEL_WARN;
const SLACK_CHANNEL_CRIT = process.env.SENTRY_SLACK_CHANNEL_CRIT;

/**
 * Mirror of OBSERVABILITY.md alert table. Update this list when you
 * add a new structured log event you want to alert on; re-run the
 * script to create the rule.
 *
 * `interval` values supported by Sentry: 1m, 5m, 15m, 1h, 1d, 1w, 30d.
 * Frequency: re-alert suppression window in minutes (5–43200).
 */
const ALERTS = [
  // ─── Critical — page on-call ─────────────────────────────────────
  { name: 'Stripe webhook processing failed',     event: 'stripe_webhook_processing_failed',     value: 0, interval: '5m', severity: 'critical' },
  { name: 'N-Genius webhook processing failed',   event: 'n_genius_webhook_processing_failed',   value: 0, interval: '5m', severity: 'critical' },
  { name: 'Ziina webhook processing failed',      event: 'ziina_webhook_processing_failed',      value: 0, interval: '5m', severity: 'critical' },
  { name: 'Livery invoice issue failed',          event: 'livery_invoice_issue_failed',          value: 0, interval: '5m', severity: 'critical' },
  { name: 'Webhook no club resolved',             event: 'webhook_no_club_resolved',             value: 3, interval: '5m', severity: 'critical' },
  { name: 'Booking refund ledger conflict',       event: 'booking_refund_ledger_conflict',       value: 0, interval: '1h', severity: 'critical' },
  { name: 'Stripe OAuth state invalid',           event: 'stripe_oauth_state_invalid',           value: 5, interval: '5m', severity: 'critical' },
  { name: 'Livery cron bad secret',               event: 'livery_cron_bad_secret',               value: 0, interval: '5m', severity: 'critical' },

  // ─── Warning — Slack ─────────────────────────────────────────────
  { name: 'Stripe webhook in flight (sustained)', event: 'stripe_webhook_in_flight',             value: 10, interval: '5m', severity: 'warning' },
  { name: 'Webhook no booking for event',         event: 'webhook_no_booking_for_event',         value: 10, interval: '5m', severity: 'warning' },
  { name: 'Rate limit exceeded',                  event: 'rate_limit_exceeded',                  value: 50, interval: '5m', severity: 'warning' },
  { name: 'Upload magic-byte mismatch',           event: 'upload_magic_byte_mismatch',           value: 3,  interval: '1h', severity: 'warning' },
  { name: 'Booking refund provider error',        event: 'booking_refund_provider_error',        value: 3,  interval: '1h', severity: 'warning' },
  { name: 'Email send failed',                    event: 'email_send_failed',                    value: 5,  interval: '5m', severity: 'warning' },
  { name: 'Email send unhandled',                 event: 'email_send_unhandled',                 value: 0,  interval: '5m', severity: 'warning' },
  { name: 'Livery payment intent failed',         event: 'livery_payment_intent_failed',         value: 5,  interval: '1h', severity: 'warning' },
];

function buildPayload(alert) {
  /** @type {Array<Record<string, unknown>>} */
  const actions = [
    // Default email action — works without any per-org integration
    // configuration. Swap or augment with Slack / PagerDuty by setting
    // SENTRY_SLACK_WORKSPACE etc.
    {
      id: 'sentry.mail.actions.NotifyEmailAction',
      targetType: 'IssueOwners',
      fallthroughType: 'ActiveMembers',
    },
  ];

  if (SLACK_WORKSPACE) {
    const channel =
      alert.severity === 'critical'
        ? (SLACK_CHANNEL_CRIT ?? SLACK_CHANNEL_WARN)
        : (SLACK_CHANNEL_WARN ?? SLACK_CHANNEL_CRIT);
    if (channel) {
      actions.push({
        id: 'sentry.integrations.slack.notify_action.SlackNotifyServiceAction',
        workspace: SLACK_WORKSPACE,
        channel,
        tags: 'environment,level,logger.event',
      });
    }
  }

  return {
    name: alert.name,
    actionMatch: 'all',
    filterMatch: 'all',
    frequency: 30,
    environment: ENV,
    conditions: [
      {
        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
        value: alert.value,
        interval: alert.interval,
      },
    ],
    filters: [
      {
        id: 'sentry.rules.filters.tagged_event.TaggedEventFilter',
        key: 'logger.event',
        match: 'eq',
        value: alert.event,
      },
    ],
    actions,
  };
}

async function sentryFetch(path, init) {
  const res = await fetch(`${SENTRY_BASE}/api/0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sentry ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function listExistingRules() {
  // Pagination: Sentry pages at 100 by default. Walk Link headers if
  // there's ever > 100 rules; for now we read the first page only.
  return sentryFetch(`/projects/${ORG}/${PROJECT}/rules/?per_page=100`);
}

async function createRule(payload) {
  return sentryFetch(`/projects/${ORG}/${PROJECT}/rules/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function main() {
  console.log(`org=${ORG} project=${PROJECT} env=${ENV} dryRun=${DRY_RUN}`);

  /** @type {Array<{ name: string }>} */
  let existing = [];
  try {
    existing = await listExistingRules();
  } catch (err) {
    console.error('failed to list existing rules:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const existingNames = new Set(existing.map((r) => r.name));
  console.log(`found ${existing.length} existing rule(s)`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const alert of ALERTS) {
    if (existingNames.has(alert.name)) {
      console.log(`skip   ${alert.name} (exists)`);
      skipped++;
      continue;
    }

    const payload = buildPayload(alert);

    if (DRY_RUN) {
      console.log(`dry    ${alert.name}`);
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    try {
      await createRule(payload);
      console.log(`create ${alert.name}`);
      created++;
    } catch (err) {
      console.error(`fail   ${alert.name}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`\nsummary: created=${created} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
