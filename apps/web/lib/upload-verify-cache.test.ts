import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractR2KeyFromUrl } from './upload-verify-cache';

// Audit pass-5 MED-1 (2026-05-21): the origin pin on `extractR2KeyFromUrl`
// is the single chokepoint that prevents a staff/groom/vet account with
// document-upload permission from persisting an attacker-origin URL while
// the magic-byte gate verifies the real R2 object at the same pathname.
// These tests lock that pin in so a future refactor can't silently
// downgrade it back to "any origin so long as the path shape matches."

const R2_PUBLIC_URL = 'https://cdn.cavaliq.test';
const VALID_KEY = '11111111-1111-4111-8111-111111111111/horses/documents/1700000000-vet-note.pdf';

describe('extractR2KeyFromUrl', () => {
  const originalEnv = process.env.R2_PUBLIC_URL;

  beforeEach(() => {
    process.env.R2_PUBLIC_URL = R2_PUBLIC_URL;
  });

  afterEach(() => {
    process.env.R2_PUBLIC_URL = originalEnv;
  });

  it('accepts a URL on the configured R2 origin with a valid key shape', () => {
    expect(extractR2KeyFromUrl(`${R2_PUBLIC_URL}/${VALID_KEY}`)).toBe(VALID_KEY);
  });

  it('rejects a URL whose origin does not match R2_PUBLIC_URL even when the path looks like a key', () => {
    // Pre-fix this passed because only KEY_PATTERN was checked. An attacker
    // posting `https://attacker.example/<valid-r2-path>` got the verify gate
    // to read the real R2 object, then persisted the attacker URL as a doc link.
    expect(extractR2KeyFromUrl(`https://attacker.example/${VALID_KEY}`)).toBeNull();
  });

  it('rejects a URL with the right origin but a malformed key shape', () => {
    expect(extractR2KeyFromUrl(`${R2_PUBLIC_URL}/not/a/real/key`)).toBeNull();
  });

  it('rejects a non-URL string', () => {
    expect(extractR2KeyFromUrl('javascript:alert(1)')).toBeNull();
    expect(extractR2KeyFromUrl('not a url')).toBeNull();
  });

  it('returns null when R2_PUBLIC_URL is unset (refuses to silently downgrade)', () => {
    delete process.env.R2_PUBLIC_URL;
    expect(extractR2KeyFromUrl(`${R2_PUBLIC_URL}/${VALID_KEY}`)).toBeNull();
  });

  it('returns null when R2_PUBLIC_URL is unparseable', () => {
    process.env.R2_PUBLIC_URL = 'not-a-url';
    expect(extractR2KeyFromUrl(`https://cdn.cavaliq.test/${VALID_KEY}`)).toBeNull();
  });

  it('treats a different port on the same host as a different origin', () => {
    expect(extractR2KeyFromUrl(`https://cdn.cavaliq.test:8080/${VALID_KEY}`)).toBeNull();
  });

  it('treats http vs https as different origins', () => {
    expect(extractR2KeyFromUrl(`http://cdn.cavaliq.test/${VALID_KEY}`)).toBeNull();
  });
});
