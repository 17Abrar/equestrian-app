/**
 * Audit pass-7 (2026-05-24 MED-1): defensive render-time URL constructors for
 * social-profile links. Stored values reach us in three shapes — bare handle
 * (`myclub`), `@`-prefixed handle (`@myclub`), or a full URL on the platform
 * host (`https://instagram.com/myclub`). Older rows MAY also contain
 * arbitrary URLs that predate the schema tightening in this audit pass; this
 * helper always extracts the handle and rebuilds the canonical platform URL,
 * so a stored `https://evil.com/phish` cannot exit through an "Instagram"
 * badge anchor on the public profile page.
 *
 * Returns `null` when the input cannot be normalized — callers should treat
 * `null` as "do not render the link".
 */

const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const FACEBOOK_HANDLE_RE = /^[A-Za-z0-9.]{3,80}$/;
const TIKTOK_HANDLE_RE = /^[A-Za-z0-9._]{2,24}$/;

function extractHandle(raw: string, urlHostRe: RegExp, handleRe: RegExp): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!urlHostRe.test(parsed.host)) return null;
      // First path segment is the handle. `/myclub`, `/@myclub`, `/myclub/posts/123`
      // all resolve to `myclub`.
      const first = parsed.pathname.split('/').filter(Boolean)[0];
      if (!first) return null;
      const clean = first.replace(/^@/, '');
      return handleRe.test(clean) ? clean : null;
    } catch {
      return null;
    }
  }

  const clean = trimmed.replace(/^@/, '');
  return handleRe.test(clean) ? clean : null;
}

export function instagramUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const handle = extractHandle(raw, /^(www\.)?instagram\.com$/i, INSTAGRAM_HANDLE_RE);
  return handle ? `https://instagram.com/${handle}` : null;
}

export function facebookUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const handle = extractHandle(raw, /^(www\.|m\.)?facebook\.com$/i, FACEBOOK_HANDLE_RE);
  return handle ? `https://facebook.com/${handle}` : null;
}

export function tiktokUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const handle = extractHandle(raw, /^(www\.)?tiktok\.com$/i, TIKTOK_HANDLE_RE);
  return handle ? `https://tiktok.com/@${handle}` : null;
}
