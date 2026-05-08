import { describe, expect, it } from 'vitest';
import { PHI_KEYS } from '../constants';
import { sanitize, scrubPiiInString, type RedactorConfig } from './log-redactor';

// Audit F-43 (2026-05-08 r6): assert that every PHI shape exits as
// `[REDACTED]` regardless of nesting depth. Mirrors the production
// config in `apps/web/lib/logger.ts:31-85`. If the production config
// changes (new key, new pattern), this test config should change too —
// drift between the two is the failure mode this whole test suite
// exists to prevent.

const PRODUCTION_SENSITIVE_KEYS = new Set<string>([
  // Auth / secrets
  'password', 'token', 'cardnumber', 'secret', 'authorization',
  'apikey', 'api_key', 'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token', 'creditcard', 'credit_card',
  'ssn', 'cvv',
  // PII
  'email', 'recipient', 'to', 'cc', 'bcc', 'subject',
  'phone', 'phonenumber', 'phone_number',
  'dateofbirth', 'date_of_birth',
  'displayname', 'display_name',
  'medicalnotes', 'medical_notes',
  'emergencycontactphone', 'emergency_contact_phone',
  'emergencycontactname', 'emergency_contact_name',
  'guestemail', 'guest_email', 'guestphone', 'guest_phone',
  'guestname', 'guest_name',
  // PHI
  ...PHI_KEYS.map((k) => k.toLowerCase()),
  'vet_instructions',
  // Stripe / payment-provider account ids
  'externalaccountid', 'external_account_id',
  'provideraccountid', 'provider_account_id',
]);

const PII_PATTERNS = [
  { regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '[REDACTED-EMAIL]' },
  { regex: /\+\d[\d\s().-]{6,}\d/g, replacement: '[REDACTED-PHONE]' },
  { regex: /\(\d{2,4}\)\s*\d[\d\s.-]{4,}\d/g, replacement: '[REDACTED-PHONE]' },
];
const BARE_GCC_PHONE_PATTERN = /\b0[5-9]\d{8}\b/g;
const FREE_TEXT_KEYS = new Set([
  'note', 'message', 'comment', 'reason', 'detail', 'details', 'body', 'text',
]);

const config: RedactorConfig = {
  sensitiveKeys: PRODUCTION_SENSITIVE_KEYS,
  piiPatterns: PII_PATTERNS,
  bareGccPhonePattern: BARE_GCC_PHONE_PATTERN,
  freeTextKeys: FREE_TEXT_KEYS,
};

describe('logger redactor — key-name layer', () => {
  it('redacts password / token / secret / cardnumber at top level', () => {
    const out = sanitize({ password: 'hunter2', token: 'tok_abc', secret: 's', cardnumber: '4242' }, config);
    expect(out).toEqual({
      password: '[REDACTED]',
      token: '[REDACTED]',
      secret: '[REDACTED]',
      cardnumber: '[REDACTED]',
    });
  });

  it('redacts case-insensitively (Email, EMAIL, eMail all match)', () => {
    const out = sanitize({ Email: 'a@b.c', EMAIL: 'd@e.f', eMail: 'g@h.i' }, config);
    expect(out).toEqual({
      Email: '[REDACTED]',
      EMAIL: '[REDACTED]',
      eMail: '[REDACTED]',
    });
  });

  it('redacts every PHI key from packages/shared/constants:PHI_KEYS', () => {
    // The production logger merges in PHI_KEYS dynamically; this test
    // pins the contract: every key in that array gets value-redacted.
    for (const key of PHI_KEYS) {
      const out = sanitize({ [key]: 'sensitive medical detail' }, config) as Record<string, unknown>;
      expect(out[key], `PHI_KEY '${key}' did not redact`).toBe('[REDACTED]');
    }
  });

  it('redacts payment-provider account ids (F-51)', () => {
    const out = sanitize(
      {
        externalAccountId: 'acct_1AbCdEf',
        external_account_id: 'acct_1AbCdEf',
        providerAccountId: 'acct_xyz',
        provider_account_id: 'acct_xyz',
      },
      config,
    );
    expect(out).toEqual({
      externalAccountId: '[REDACTED]',
      external_account_id: '[REDACTED]',
      providerAccountId: '[REDACTED]',
      provider_account_id: '[REDACTED]',
    });
  });

  it('redacts at depth — nested object', () => {
    const out = sanitize(
      { audit: { changes: { email: 'rider@example.com' } } },
      config,
    ) as { audit: { changes: { email: string } } };
    expect(out.audit.changes.email).toBe('[REDACTED]');
  });

  it('redacts at depth — array element', () => {
    const out = sanitize(
      { recipients: [{ email: 'a@b.c' }, { email: 'd@e.f' }] },
      config,
    ) as { recipients: { email: string }[] };
    expect(out.recipients[0]?.email).toBe('[REDACTED]');
    expect(out.recipients[1]?.email).toBe('[REDACTED]');
  });

  it('caps recursion at depth 5 — deeper nests collapse to [nested]', () => {
    // 6 levels of nesting: a.b.c.d.e.f — 'f' is at depth 6.
    const deep = { a: { b: { c: { d: { e: { f: { email: 'a@b.c' } } } } } } };
    const out = sanitize(deep, config);
    // Walk down to depth 5 (a.b.c.d.e is at depth 5), at which point
    // the recursion replaces with '[nested]'. Don't assert on the
    // exact path — just confirm the email never lands plaintext.
    const stringified = JSON.stringify(out);
    expect(stringified).not.toContain('a@b.c');
    expect(stringified).toContain('[nested]');
  });
});

describe('logger redactor — value regex layer', () => {
  // NB: tests below use non-sensitive keys (`label`, `event`) so the
  // value-regex layer actually runs. Sensitive keys (`description`,
  // `notes`) hit the key-name layer first and emit `[REDACTED]`
  // wholesale — that's tested in the key-name suite above.
  it('redacts emails embedded in non-sensitive string keys', () => {
    const out = sanitize(
      { label: 'reach out at rider@example.com please' },
      config,
    ) as { label: string };
    expect(out.label).toContain('[REDACTED-EMAIL]');
    expect(out.label).not.toContain('rider@example.com');
  });

  it('redacts international phones (+CC) in non-sensitive string keys', () => {
    const out = sanitize(
      { event: 'call +971 50 123 4567 to confirm' },
      config,
    ) as { event: string };
    expect(out.event).toContain('[REDACTED-PHONE]');
    expect(out.event).not.toContain('+971 50 123 4567');
  });

  it('redacts parenthesized US-style phones', () => {
    const out = sanitize(
      { event: 'office is (212) 555-1234' },
      config,
    ) as { event: string };
    expect(out.event).toContain('[REDACTED-PHONE]');
    expect(out.event).not.toContain('(212) 555-1234');
  });

  it('does NOT redact plain integer ids (booking number, transaction id)', () => {
    const out = sanitize(
      {
        bookingNumber: '12345678',
        transactionId: '0123456789012345',
        invoiceNumber: 'INV-12345678',
      },
      config,
    );
    expect(out).toEqual({
      bookingNumber: '12345678',
      transactionId: '0123456789012345',
      invoiceNumber: 'INV-12345678',
    });
  });
});

describe('logger redactor — bare-digits GCC phone (free-text only)', () => {
  it('redacts 0501234567 inside a `note` value', () => {
    const out = sanitize({ note: 'phone is 0501234567' }, config) as { note: string };
    expect(out.note).toContain('[REDACTED-PHONE]');
    expect(out.note).not.toContain('0501234567');
  });

  it('redacts 0501234567 inside a `message` / `comment` / `body` value', () => {
    for (const key of ['message', 'comment', 'reason', 'detail', 'details', 'body', 'text']) {
      const out = sanitize({ [key]: 'call 0501234567' }, config) as Record<string, string>;
      expect(out[key], `key '${key}' did not redact bare GCC phone`).toContain('[REDACTED-PHONE]');
    }
  });

  it('does NOT redact 0501234567 inside a non-free-text key', () => {
    // `bookingNumber: '0501234567'` looks like a phone but is statistically
    // an invoice / booking id — only redact in free-text contexts.
    const out = sanitize({ bookingNumber: '0501234567' }, config);
    expect(out).toEqual({ bookingNumber: '0501234567' });
  });

  it('does NOT redact bare GCC phones at the top level (no parent key)', () => {
    const out = scrubPiiInString('0501234567', undefined, config);
    expect(out).toBe('0501234567');
  });
});

describe('logger redactor — depth + parent-key plumbing', () => {
  it('parentKey context propagates through arrays', () => {
    // The note's value is an array of strings; the bare phone in each
    // element should still be redacted because the PARENT key is `note`.
    const out = sanitize(
      { note: ['call 0501234567', 'or 0521234567'] },
      config,
    ) as { note: string[] };
    expect(out.note[0]).toContain('[REDACTED-PHONE]');
    expect(out.note[1]).toContain('[REDACTED-PHONE]');
  });

  it('reset parent-key when entering a nested object — phone in `inner.id` survives', () => {
    // `note.inner` is a sub-object; the bare-phone scrub only fires on
    // free-text PARENT keys, so `inner.id: '0501234567'` (parent is now
    // `id`, not `note`) is NOT redacted. Documents the contract.
    const out = sanitize(
      { note: { inner: { id: '0501234567' } } },
      config,
    ) as { note: { inner: { id: string } } };
    expect(out.note.inner.id).toBe('0501234567');
  });
});

describe('logger redactor — non-mutating', () => {
  it('does not mutate the input object', () => {
    const input = { email: 'a@b.c', other: 'safe' };
    sanitize(input, config);
    expect(input).toEqual({ email: 'a@b.c', other: 'safe' });
  });

  it('passes through primitives unchanged', () => {
    expect(sanitize(42, config)).toBe(42);
    expect(sanitize(null, config)).toBe(null);
    expect(sanitize(undefined, config)).toBe(undefined);
    expect(sanitize(true, config)).toBe(true);
  });
});
