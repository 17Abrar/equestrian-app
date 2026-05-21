import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractR2KeyFromUrl, findNonR2OriginUrl } from './upload-verify-cache';

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
    // Codex review nit: `process.env.X = undefined` in Node coerces to the
    // string `"undefined"`, which exercises the unparseable-env branch
    // instead of the genuinely-missing-env branch. Use `delete` with the
    // looser index-signature cast so the strict Worker env types don't
    // refuse the operator while we actually drive `process.env.X ===
    // undefined`.
    delete (process.env as Record<string, string | undefined>).R2_PUBLIC_URL;
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

// Audit pass-5 MED-2 (2026-05-21): `findNonR2OriginUrl` is the
// persist-side helper the image-asset routes (horse photos, ownership
// registration, club branding) use to reject attacker-origin URLs at
// save time. The Zod schemas only validate `.url()`, so this is the
// single chokepoint that keeps a smuggled `https://attacker.example/...`
// out of the rendered dashboard.

describe('findNonR2OriginUrl', () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_URL = R2_PUBLIC_URL;
  });

  it('returns null when every URL is R2-origin', () => {
    expect(
      findNonR2OriginUrl([`${R2_PUBLIC_URL}/${VALID_KEY}`, `${R2_PUBLIC_URL}/${VALID_KEY}`]),
    ).toBeNull();
  });

  it('returns null on an all-empty / nullish list (field cleared, not set)', () => {
    expect(findNonR2OriginUrl([null, undefined, ''])).toBeNull();
  });

  it('returns the first non-R2-origin URL', () => {
    const bad = 'https://attacker.example/foo.png';
    expect(findNonR2OriginUrl([`${R2_PUBLIC_URL}/${VALID_KEY}`, bad])).toBe(bad);
  });

  it('rejects an R2-origin URL with a non-key path (no leak via path shape)', () => {
    const bad = `${R2_PUBLIC_URL}/wrong/shape.png`;
    expect(findNonR2OriginUrl([bad])).toBe(bad);
  });
});
