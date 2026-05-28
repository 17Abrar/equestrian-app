import { describe, it, expect } from 'vitest';
import { instagramUrl, facebookUrl, tiktokUrl } from './social-link';

// Audit pass-7 (2026-05-24 MED-1): these helpers are the render-time
// defence for legacy rows that may still contain off-platform URLs.
// Even with the schema tightening in `packages/shared/src/schemas/index.ts`,
// existing DB rows that predate the tightening would slip through if
// rendered as `<a href={raw}>`. The test cases here mirror the four
// shapes the field can carry — bare handle, @-handle, canonical URL,
// off-platform garbage — and lock the "return null for garbage" invariant.

describe('instagramUrl', () => {
  it('canonicalizes a bare handle', () => {
    expect(instagramUrl('myclub')).toBe('https://instagram.com/myclub');
  });
  it('strips a leading @', () => {
    expect(instagramUrl('@myclub')).toBe('https://instagram.com/myclub');
  });
  it('passes through a canonical instagram.com URL', () => {
    expect(instagramUrl('https://instagram.com/myclub')).toBe('https://instagram.com/myclub');
  });
  it('strips a trailing path segment to the bare handle', () => {
    expect(instagramUrl('https://instagram.com/myclub/posts/123')).toBe(
      'https://instagram.com/myclub',
    );
  });
  it('returns null for an off-platform URL (phishing defence)', () => {
    expect(instagramUrl('https://evil.com/phish')).toBe(null);
  });
  it('returns null for a javascript: URL', () => {
    expect(instagramUrl("javascript:alert('xss')")).toBe(null);
  });
  it('returns null for null/empty input', () => {
    expect(instagramUrl(null)).toBe(null);
    expect(instagramUrl('')).toBe(null);
    expect(instagramUrl('   ')).toBe(null);
  });
});

describe('facebookUrl', () => {
  it('canonicalizes a bare handle', () => {
    expect(facebookUrl('myclub')).toBe('https://facebook.com/myclub');
  });
  it('accepts www. subdomain', () => {
    expect(facebookUrl('https://www.facebook.com/myclub')).toBe('https://facebook.com/myclub');
  });
  it('returns null for an off-platform URL', () => {
    expect(facebookUrl('https://evil.com/phish')).toBe(null);
  });
});

describe('tiktokUrl', () => {
  it('canonicalizes a bare handle with @ prefix', () => {
    expect(tiktokUrl('myclub')).toBe('https://tiktok.com/@myclub');
  });
  it('passes through an @-prefixed canonical URL', () => {
    expect(tiktokUrl('https://tiktok.com/@myclub')).toBe('https://tiktok.com/@myclub');
  });
  it('returns null for an off-platform URL', () => {
    expect(tiktokUrl('https://evil.com/phish')).toBe(null);
  });
});
