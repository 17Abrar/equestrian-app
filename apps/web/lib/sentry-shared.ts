import type { Breadcrumb, BreadcrumbHint, ErrorEvent, EventHint } from '@sentry/nextjs';

// Query-param keys that commonly carry credentials OR PII. Matched case-
// insensitively against the param name. Any matching value is replaced with
// `[REDACTED]` before the event leaves the server.
//
// Audit QA-37 — extended to cover PII keys (email/phone/name/user/customer)
// so URL scrubs never leak query-string PII to the error vendor.
//
// Audit F-27 (2026-05-06): NB — `sendDefaultPii` is currently set to
// `false` in both `sentry.server.config.ts` and
// `instrumentation-client.ts` (audit F-4 2026-05-05 turned it off).
// IP/UA are NOT being sent today. The scrubbers below remain on as
// defense-in-depth for any future opt-in. If `sendDefaultPii` flips
// back to `true`, extend the SENSITIVE_QUERY_KEY pattern as needed.
const SENSITIVE_QUERY_KEY =
  /code|state|token|secret|key|session|password|email|phone|name|user|customer/i;

// Pattern that matches sensitive query strings inside arbitrary text
// (e.g. fetch breadcrumb messages like `GET /callback?code=ac_xxx&state=…`).
// Replaces the value portion only — keeps the rest of the message readable.
const QUERY_PARAM_IN_TEXT =
  /([?&])(code|state|token|secret|key|session|password|email|phone|name|user|customer)=([^&\s"']+)/gi;

function redactQueryParamsInText(text: string): string {
  return text.replace(QUERY_PARAM_IN_TEXT, '$1$2=[REDACTED]');
}

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
      // Audit H-8: many integrations attach the URL to `crumb.message`
      // (the rendered "GET /api/v1/foo?code=xx" string) rather than
      // `crumb.data.url`. Strip query-param values here too so the
      // event-level scrub is defence-in-depth for the breadcrumb-level
      // scrubber registered as `beforeBreadcrumb`.
      if (typeof crumb.message === 'string') {
        crumb.message = redactQueryParamsInText(crumb.message);
      }
    }
  }
  return event;
}

/**
 * Sentry `beforeBreadcrumb` hook (audit H-8). Runs once per breadcrumb at
 * collection time, BEFORE the event is queued — catches the
 * `?code=ac_xxx&state=…` shape on fetch/console/navigation breadcrumbs
 * regardless of where it lands (`data.url`, `data.to`, `message`).
 */
export function scrubSentryBreadcrumb(
  breadcrumb: Breadcrumb,
  _hint?: BreadcrumbHint,
): Breadcrumb | null {
  if (breadcrumb.data) {
    for (const key of Object.keys(breadcrumb.data)) {
      const value = breadcrumb.data[key];
      if (typeof value === 'string') {
        if (key.toLowerCase() === 'url') {
          breadcrumb.data[key] = scrubUrl(value) ?? value;
        } else {
          breadcrumb.data[key] = redactQueryParamsInText(value);
        }
      }
    }
  }
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = redactQueryParamsInText(breadcrumb.message);
  }
  return breadcrumb;
}
