import * as Sentry from '@sentry/nextjs';

// Runs on every server-rendered request and inside API routes.
// Sentry.init is a no-op if SENTRY_DSN is unset, so it's safe to ship
// without a DSN in dev.

// Query-param keys that commonly carry credentials. Matched case-insensitively
// against the param name. Any matching value is replaced with `[REDACTED]`
// before the event leaves the server.
const SENSITIVE_QUERY_KEY = /code|state|token|secret|key|session|password/i;

function scrubUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    let mutated = false;
    for (const [name] of url.searchParams) {
      if (SENSITIVE_QUERY_KEY.test(name)) {
        url.searchParams.set(name, '[REDACTED]');
        mutated = true;
      }
    }
    return mutated ? url.toString() : raw;
  } catch {
    // Non-absolute URLs (path-only) — best-effort scrub of `?…` segment.
    const qIdx = raw.indexOf('?');
    if (qIdx === -1) return raw;
    const params = new URLSearchParams(raw.slice(qIdx + 1));
    let mutated = false;
    for (const [name] of params) {
      if (SENSITIVE_QUERY_KEY.test(name)) {
        params.set(name, '[REDACTED]');
        mutated = true;
      }
    }
    return mutated ? `${raw.slice(0, qIdx)}?${params.toString()}` : raw;
  }
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  sendDefaultPii: true,
  // 10% prod sampling keeps ingest cost bounded; 100% in dev for full signal.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  includeLocalVariables: true,
  enableLogs: true,
  enabled: !!process.env.SENTRY_DSN,

  // Strip credentials from headers AND from URLs/breadcrumbs. `sendDefaultPii:
  // true` would otherwise capture the Stripe OAuth `?code=…&state=…` callback
  // verbatim (a long-lived authorization code stored in our error vendor),
  // plus Clerk `__session` cookies on the URL of any 500 hit during sign-in.
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['set-cookie'];
      for (const name of Object.keys(event.request.headers)) {
        if (name.toLowerCase().startsWith('x-clerk-')) {
          delete event.request.headers[name];
        }
      }
    }
    event.request = event.request ?? {};
    event.request.url = scrubUrl(event.request.url);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubUrl(`?${event.request.query_string}`)?.slice(1);
    }
    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        if (crumb.data && typeof crumb.data.url === 'string') {
          crumb.data.url = scrubUrl(crumb.data.url);
        }
      }
    }
    return event;
  },
});
