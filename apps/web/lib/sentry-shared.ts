import type { ErrorEvent, EventHint } from '@sentry/nextjs';

// Query-param keys that commonly carry credentials. Matched case-insensitively
// against the param name. Any matching value is replaced with `[REDACTED]`
// before the event leaves the server.
const SENSITIVE_QUERY_KEY = /code|state|token|secret|key|session|password/i;

export function scrubUrl(raw: string | undefined): string | undefined {
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

/**
 * Sentry `beforeSend` hook used by both the Node (server) and edge runtime
 * configs. Strips credentials from headers AND from URLs/breadcrumbs so the
 * Stripe Connect OAuth callback (`?code=…&state=…`), Clerk `__session`
 * cookies, and similar are never persisted in the error vendor.
 *
 * Pure JS using only URL/URLSearchParams — both available in Node and the
 * edge runtime, so this works in either init.
 */
export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
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
}
