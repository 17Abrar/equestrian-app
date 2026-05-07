/* eslint-disable no-undef, no-console -- Cloudflare Worker entry: URL,
   Request, console are globals in the Worker runtime; logs are intentional
   and drain to Cloudflare's observability pipeline. */
// Wrapper around the OpenNext-generated Cloudflare Worker that adds a
// `scheduled()` export so Cloudflare Cron Triggers can fire our internal
// billing jobs. OpenNext 1.x doesn't expose a wrapper override in
// `open-next.config.ts`, so we re-export the generated module's surface here
// and tack on `scheduled()`.
//
// Build order:
//   1. `pnpm opennextjs-cloudflare build`  — generates `.open-next/worker.js`
//   2. `wrangler deploy` — uses this file (per wrangler.jsonc `main`)
//
// Cron wiring: when a cron trigger fires, we construct internal POST
// requests to BOTH cron endpoints (`/api/cron/livery-billing` for club →
// owner livery invoices, `/api/cron/platform-billing` for Cavaliq → club
// subscription invoices) and hand them directly to the generated worker's
// own fetch handler. Keeps the traffic inside the isolate — no public
// round-trip — and gets the same auth middleware behavior as an external
// call. Both runs are independent: a failure in one doesn't block the
// other.

import worker from './.open-next/worker.js';

// Re-export any Durable Object classes the generated worker exports so
// Cloudflare can still bind them. OpenNext currently exports these three;
// if they add more we'll see a "missing export" error at deploy and can
// mirror it.
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';

// Audit F-43 (2026-05-07 r4): one-shot env-binding self-check. Per
// isolate, fire a single GET to `/api/cron/self-check` with the
// expected `x-cron-secret` header. The route reads
// `process.env.CRON_SECRET` (the Next.js runtime binding) and returns
// 200 when the value matches, 503 when missing, 401 when mismatched.
// A 503 means Cloudflare's `env.CRON_SECRET` is set but Next.js doesn't
// see it — every subsequent cron tick will silently fail with the same
// 503, and the operator's only signal pre-fix was grepping logs for
// `_secret_not_configured`. This loud `cron_secret_binding_mismatch`
// makes the misconfig trivially visible.
let bindingCheckedThisIsolate = false;

async function verifyCronSecretBinding(env, ctx) {
  if (bindingCheckedThisIsolate) return;
  bindingCheckedThisIsolate = true;

  try {
    const url = new URL('/api/cron/self-check', 'https://internal.worker/');
    const probe = new Request(url.toString(), {
      method: 'GET',
      headers: {
        'x-cron-secret': env.CRON_SECRET,
        'user-agent': 'cavaliq-cron-binding-check',
      },
    });
    const res = await worker.fetch(probe, env, ctx);
    // Audit F-73 (2026-05-07 r4 Xi-bis): pull the route's error envelope
    // (code/message) into the binding-check log so operators see WHY,
    // not just "503". The probe route uses `requireCronSecret` which
    // returns the standard `{ success: false, error: { code, message } }`
    // shape on failure. Best-effort parse — non-JSON bodies fall back
    // to undefined and the log keeps the bare status.
    const bodyText = await res.text().catch(() => '');
    let errorCode;
    let errorMessage;
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed === 'object' && parsed.error) {
          errorCode = parsed.error.code;
          errorMessage = parsed.error.message;
        }
      } catch {
        /* not JSON — fine */
      }
    }
    if (res.status === 503) {
      console.error('cron_secret_binding_mismatch', {
        message:
          'env.CRON_SECRET is set on the worker, but Next.js sees process.env.CRON_SECRET as undefined — Cloudflare → Next.js binding propagation is broken. Every cron tick will 503 until fixed.',
        status: res.status,
        routeErrorCode: errorCode,
        routeErrorMessage: errorMessage,
      });
    } else if (res.status === 401) {
      console.error('cron_secret_binding_drift', {
        message:
          'env.CRON_SECRET and process.env.CRON_SECRET have different values — likely a partial secret rotation that updated only one side.',
        status: res.status,
        routeErrorCode: errorCode,
        routeErrorMessage: errorMessage,
      });
    } else if (res.status !== 200) {
      console.error('cron_secret_binding_unexpected', {
        status: res.status,
        routeErrorCode: errorCode,
        routeErrorMessage: errorMessage,
      });
    }
  } catch (err) {
    // Probe failure is itself a signal — but a transient fetch error
    // shouldn't gate the real cron run. Log and let the cron tasks
    // proceed; if the binding truly is broken, the per-task 503 fallback
    // log will fire below as a secondary signal.
    console.error('cron_secret_binding_check_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export default {
  fetch: worker.fetch,

  /**
   * Cloudflare Cron Trigger entrypoint. Schedule comes from
   * wrangler.jsonc → triggers.crons.
   *
   * Fires POSTs to BOTH cron endpoints. Each route checks `x-cron-secret`
   * against the CRON_SECRET env secret and runs its respective billing
   * pass. The two runs are independent — a failure in one doesn't block
   * the other.
   */
  async scheduled(event, env, ctx) {
    // Audit L-9: refuse to send a cron tick when CRON_SECRET is missing
    // from the worker env. The route would 401 either way, but a loud
    // startup error makes the misconfig visible in tail logs immediately
    // instead of after the day's billing has been silently skipped.
    if (!env.CRON_SECRET) {
      console.error('cron_scheduled_skipped_missing_secret', {
        cron: event.cron,
      });
      return;
    }

    // Audit F-43 (2026-05-07 r4): one-shot binding self-check. Logs
    // `cron_secret_binding_mismatch` if Next.js's runtime can't see
    // `process.env.CRON_SECRET` even though Cloudflare's `env` does.
    // No-op on subsequent invocations within the same isolate.
    await verifyCronSecretBinding(env, ctx);

    // Audit PROC-1 (2026-05-05 pass 2) + Round 6.1 + Round 6.2:
    // dispatch by `event.cron` so each billing/reminder cron runs on
    // its own 30-second-CPU-budget invocation.
    //   `0 2 * * *`  → livery billing
    //   `15 2 * * *` → platform billing (issuance + reminders + trial)
    //   `0 * * * *`  → booking-reminder cron (hourly)
    //   `0 3 * * *`  → horse-care reminder cron (Round 6.2)
    // Unknown cron strings fall back to running every billing target
    // (defensive — a misconfigured wrangler.jsonc shouldn't silently
    // skip the cron the operator forgot to route). The hourly booking
    // reminder + the horse-care reminder are intentionally NOT in the
    // fallback because triggering them on a wrong schedule could fan
    // out unwanted emails (booking reminder) or repeat already-sent
    // threshold pings unnecessarily.
    const KNOWN_CRON_TARGETS = {
      '0 2 * * *': [{ path: '/api/cron/livery-billing', label: 'livery' }],
      '15 2 * * *': [{ path: '/api/cron/platform-billing', label: 'platform' }],
      '0 * * * *': [
        { path: '/api/cron/booking-reminders', label: 'booking_reminders' },
      ],
      '0 3 * * *': [
        { path: '/api/cron/horse-care-reminders', label: 'horse_care' },
      ],
    };
    // Audit F-26 (2026-05-06 comprehensive). Hard-fail an unknown
    // schedule rather than silently routing to livery+platform. The
    // previous fallback meant a misconfigured wrangler.jsonc (e.g. an
    // `0 * * * *` rewritten to `0 1 * * *` by accident) would silently
    // double-fire the daily crons every hour AND drop every booking-
    // reminder tick — the cron schedule is a load-bearing config, not
    // a hint. Operators see `cron_scheduled_unknown_schedule` in
    // Cloudflare Logpush; pair with a Sentry alert rule on the event.
    const cronTargets = KNOWN_CRON_TARGETS[event.cron];
    if (!cronTargets) {
      console.error('cron_scheduled_unknown_schedule', {
        cron: event.cron,
        knownSchedules: Object.keys(KNOWN_CRON_TARGETS),
      });
      return;
    }

    const tasks = cronTargets.map((target) => {
      const url = new URL(target.path, 'https://internal.worker/');
      const request = new Request(url.toString(), {
        method: 'POST',
        headers: {
          'x-cron-secret': env.CRON_SECRET,
          'content-type': 'application/json',
          'user-agent': 'cavaliq-cron-scheduled',
        },
      });

      return worker
        .fetch(request, env, ctx)
        .then(async (res) => {
          // Drain the response body so the isolate doesn't hold the socket
          // open; we don't read its content — see audit G-27, body could
          // include `error.message` text we'd rather not echo.
          await res.text().catch(() => '');
          if (!res.ok) {
            console.error('cron_scheduled_non_ok', {
              cron: event.cron,
              target: target.label,
              status: res.status,
            });
          } else {
            console.log('cron_scheduled_ok', {
              cron: event.cron,
              target: target.label,
              status: res.status,
            });
          }
        })
        .catch((err) => {
          // Fetch-level throw: the request never made it to the route, so
          // there's no Sentry-connected logger.error inside Next.js to
          // emit a tagged event. Best-effort signal via console.error so
          // it lands in Cloudflare's observability tail. Operators
          // monitoring `cron_scheduled_failed` need a separate Logpush
          // alert rule until @sentry/cloudflare is wired into this entry —
          // tracked by audit H-6 / F-35 (2026-05-06).
          console.error('cron_scheduled_failed', {
            cron: event.cron,
            target: target.label,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });

    // Audit F-72 (2026-05-07 r4 Xi-bis): switched from `Promise.all` to
    // `Promise.allSettled`. Each task already swallows its own errors so
    // either resolves cleanly today, but a future contributor adding an
    // unhandled throw inside a `.then` (e.g., before the `.catch` gets
    // attached) would short-circuit `Promise.all` and leave sibling
    // crons unawaited via `ctx.waitUntil`. `allSettled` is the
    // defence-in-depth primitive for fan-out + fire-and-forget.
    ctx.waitUntil(Promise.allSettled(tasks));
  },
};
