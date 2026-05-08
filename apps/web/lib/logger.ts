import * as Sentry from '@sentry/nextjs';
import { PHI_KEYS } from '@equestrian/shared/constants';
import { sanitize as sharedSanitize, type RedactorConfig } from '@equestrian/shared/utils';

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
// Audit r5 F-9 (2026-05-07): merge in the canonical PHI key list so that
// a freshly-decrypted health/medication record spread into `logger.info`
// is scrubbed by key name before reaching stdout / Sentry. The list also
// covers snake_case forms (`medical_notes`) since callers occasionally
// log raw DB rows. Audit r5 F-51 (2026-05-07): Stripe `acct_…` IDs are
// infrastructure metadata that lets an attacker correlate clubs across
// leaked logs — redact `externalAccountId` / `providerAccountId`.
const SENSITIVE_KEYS = new Set<string>([
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
  // PHI — folded in from `NOTIFICATION_FORBIDDEN_FIELDS` (canonical list
  // at `packages/shared/src/constants/index.ts:PHI_KEYS`). Both casings
  // (camelCase + snake_case) covered because callers occasionally log
  // raw DB rows. The lookup itself is already lower-cased.
  ...PHI_KEYS.map((k) => k.toLowerCase()),
  'vet_instructions',
  // Stripe / payment-provider account ids — F-51.
  'externalaccountid',
  'external_account_id',
  'provideraccountid',
  'provider_account_id',
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

// Audit r5 F-50 (2026-05-07): UAE/GCC bare-digits phones (e.g.
// `0501234567`) don't carry a `+` prefix or parens, so they look
// indistinguishable from invoice / booking / transaction numbers in
// the global value scrub. Applying this regex globally would corrupt
// `bookingNumber: 'INV-12345678'` (false-negative — saved by the
// `INV-` prefix) and `transactionId: '0123456789012345'` (false-
// POSITIVE — would partially redact). Gate the pattern on context:
// only run on values whose PARENT KEY is a free-text field where a
// staff member would plausibly type a phone in prose ("rider's number
// is 0501234567"). The list deliberately omits `description` / `notes`
// because those are PHI keys and already get whole-value redaction
// at the key-name layer above.
const BARE_GCC_PHONE_PATTERN = /\b0[5-9]\d{8}\b/g;
const FREE_TEXT_KEYS = new Set([
  'note',
  'message',
  'comment',
  'reason',
  'detail',
  'details',
  'body',
  'text',
]);

// Audit F-43 (2026-05-08 r6): redactor logic extracted to
// `@equestrian/shared/utils:sanitize` so it can be unit-tested.
// Apps/web isn't on vitest; the shared package is. The config below
// captures every key/pattern this app cares about; the test suite
// in packages/shared exercises the same shape.
const REDACTOR_CONFIG: RedactorConfig = {
  sensitiveKeys: SENSITIVE_KEYS,
  piiPatterns: PII_PATTERNS,
  bareGccPhonePattern: BARE_GCC_PHONE_PATTERN,
  freeTextKeys: FREE_TEXT_KEYS,
};

function sanitize(data: unknown): unknown {
  return sharedSanitize(data, REDACTOR_CONFIG);
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
//
// Audit F-17 (2026-05-06 r2) / F-48 (2026-05-07 r4 — confirmed). The
// map below is module-scope, which in Cloudflare Workers means
// PER-ISOLATE — not global. Under horizontal load, 100 concurrent
// requests across 100 isolates can each fire 1 Sentry event per
// tuple, multiplying the cap. Sentry's own grouping + alert frequency
// conditions handle this correctly, so operators are not paged 100×;
// but the cap is best-effort, NOT a hard quota guarantee. If a true
// global ceiling becomes needed, route through a Durable Object
// counter or use Sentry's server-side rate-limit config.
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
