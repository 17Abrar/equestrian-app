import * as Sentry from '@sentry/nextjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  event: string;
  timestamp: string;
  requestId?: string;
  clubId?: string;
  userId?: string;
  [key: string]: unknown;
}

// Keys whose values are never safe to land in stdout/Logpush/Sentry. Lower-
// cased on lookup so callers don't have to think about casing. PII fields
// (email/phone/etc.) are included because CLAUDE.md explicitly forbids them
// in logs and several email/audit paths used to carry them through to Sentry
// extras — see audit D-1 / G-20. If a route legitimately needs to log a
// recipient identity for debugging, hash it (e.g. `hashEmail(...)`) before
// passing — the redactor matches on key name, so a `recipientHash` field
// passes through cleanly.
const SENSITIVE_KEYS = new Set([
  // Auth / secrets
  'password',
  'token',
  'cardnumber',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'creditcard',
  'credit_card',
  'ssn',
  'cvv',
  // PII — addressing identity, contact info, sensitive personal data
  'email',
  'recipient',
  'to',
  'cc',
  'bcc',
  'subject',
  'phone',
  'phonenumber',
  'phone_number',
  'dateofbirth',
  'date_of_birth',
  'displayname',
  'display_name',
  'medicalnotes',
  'medical_notes',
  'emergencycontactphone',
  'emergency_contact_phone',
  'emergencycontactname',
  'emergency_contact_name',
  'guestemail',
  'guest_email',
  'guestphone',
  'guest_phone',
  'guestname',
  'guest_name',
]);

// Audit LOW (2026-05-06 closeout): content-aware PII scrub. The
// key-name denylist above catches the conventional shapes
// (`{ email: ... }`, `{ phone: ... }`) but a future log call that
// shapes its payload differently (e.g. `{ description: rider.email }`,
// `{ note: 'reach out at +971 50 ...' }`) would bypass it. These
// regexes scrub the string VALUES — defense-in-depth for unconventional
// keys. The patterns are deliberately conservative to avoid corrupting
// legitimate non-PII log data (booking numbers, invoice ids, UUIDs):
//   - email: standard local@domain.tld shape
//   - phone (international): leading `+CC` then digits/separators —
//     covers `+971 50 123 4567`, `+1-555-1234`. The required `+` is
//     what discriminates a phone number from a plain integer id, so
//     plain `12345678` (booking/invoice) is NOT redacted.
//   - phone (parenthesized): `(212) 555-1234` style. The opening `(`
//     before the area code is the discriminator.
// Domestic phones written as bare digits without separators are NOT
// redacted (e.g. `0501234567` — would be indistinguishable from an
// invoice number). The conventional `phone` / `guest_phone` keys
// already redact those at the key-name layer.
const PII_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  { regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '[REDACTED-EMAIL]' },
  { regex: /\+\d[\d\s().-]{6,}\d/g, replacement: '[REDACTED-PHONE]' },
  { regex: /\(\d{2,4}\)\s*\d[\d\s.-]{4,}\d/g, replacement: '[REDACTED-PHONE]' },
];

function scrubPiiInString(value: string): string {
  let out = value;
  for (const { regex, replacement } of PII_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}

function sanitize(data: unknown, depth = 0): unknown {
  if (depth > 5) return '[nested]';

  if (typeof data === 'string') {
    return scrubPiiInString(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitize(value, depth + 1);
      }
    }
    return result;
  }

  return data;
}

function log(level: LogLevel, event: string, data?: Record<string, unknown>) {
  const sanitized = data ? (sanitize(data) as Record<string, unknown>) : {};
  const entry: LogEntry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...sanitized,
  };

  const output = JSON.stringify(entry);

  // The logger is the one place where direct `console` calls are intentional —
  // this is what writes the structured JSON to stdout/stderr that Cloudflare
  // tails into Logpush. Suppress no-console for the whole switch rather than
  // line-by-line so future cases (e.g., 'fatal') don't sneak past lint.
  /* eslint-disable no-console */
  switch (level) {
    case 'error':
      console.error(output);
      forwardToSentry('error', event, sanitized);
      break;
    case 'warn':
      console.warn(output);
      forwardToSentry('warning', event, sanitized);
      break;
    default:
      console.log(output);
  }
  /* eslint-enable no-console */
}

// Audit H-12: cap Sentry forward rate per (level, event) tuple. An
// infinite-retry loop firing `logger.error('booking_refund_provider_error')`
// 1000 times in a minute used to make 1000 synchronous Sentry network
// round-trips, burning Worker CPU and Sentry quota. Now: 1 event/sec
// per tuple — Sentry's grouping still counts the dropped events via
// alert-rule frequency conditions, and the first event in a window
// always lands so the operator still gets paged.
const FORWARD_BUCKET_WINDOW_MS = 1_000;
const sentryForwardLastAt = new Map<string, number>();

function shouldForwardToSentry(level: string, event: string): boolean {
  const key = `${level}:${event}`;
  const now = Date.now();
  const last = sentryForwardLastAt.get(key);
  if (last !== undefined && now - last < FORWARD_BUCKET_WINDOW_MS) {
    return false;
  }
  sentryForwardLastAt.set(key, now);
  // Bound map size — at one entry per (level, event) tuple we
  // shouldn't exceed a few hundred, but a runaway tag value would
  // grow it without limit. Trim on every miss.
  if (sentryForwardLastAt.size > 1000) {
    const cutoff = now - FORWARD_BUCKET_WINDOW_MS * 60;
    for (const [k, t] of sentryForwardLastAt) {
      if (t < cutoff) sentryForwardLastAt.delete(k);
    }
  }
  return true;
}

function forwardToSentry(
  level: 'error' | 'warning',
  event: string,
  data: Record<string, unknown>,
) {
  // Skip when Sentry isn't configured — avoids meaningless traffic in dev.
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (!shouldForwardToSentry(level, event)) return;

  // Pull the error object out if present so Sentry renders a real stack
  // trace instead of a one-line message.
  const errorValue = data.error;
  const errorInstance =
    errorValue instanceof Error
      ? errorValue
      : typeof errorValue === 'string'
        ? new Error(errorValue)
        : null;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag('logger.event', event);
    if (typeof data.clubId === 'string') scope.setTag('club_id', data.clubId);
    if (typeof data.userId === 'string') scope.setUser({ id: data.userId });
    if (typeof data.requestId === 'string') scope.setTag('request_id', data.requestId);
    // Full sanitized payload goes in extras so it's visible on the event page
    // without being promoted to searchable tags.
    scope.setContext('log_data', data);

    if (errorInstance) {
      Sentry.captureException(errorInstance);
    } else {
      Sentry.captureMessage(event, level);
    }
  });
}

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => log('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => log('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
  debug: (event: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      log('debug', event, data);
    }
  },
};
