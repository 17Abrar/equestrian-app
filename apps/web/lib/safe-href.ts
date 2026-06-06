/**
 * Audit LOW-10 (2026-05-05): href hardener for any user-/external-data-
 * driven URL we render into an `<a href>` or pass to `window.open`. Without
 * this guard, a malicious string like `javascript:fetch('/api/...')` rendered
 * into an anchor tag triggers code execution in the user's session on click.
 * Our pay links and document URLs come from trusted server paths today, but
 * the cost of a defense-in-depth check at the render boundary is one regex
 * and a few µs.
 *
 * Allows `http(s)`, `mailto`, and `tel`. Anything else (including
 * `javascript:`, `data:`, relative protocols, and malformed URLs) collapses
 * to `'#'` so the link clicks to nothing instead of executing.
 *
 * Path-only hrefs (e.g. `/dashboard`) are passed through — we still want
 * `<Link href="/discover">` to work.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeHref(raw: string | null | undefined): string {
  if (!raw) return '#';
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '#';

  // Protocol-relative (`//evil.com`) and backslash variants resolve to a
  // cross-origin navigation in the browser, so they must not slip through the
  // path-passthrough below. Mirror safe-redirect.ts which rejects the same.
  if (trimmed.startsWith('//') || trimmed.startsWith('\\')) return '#';

  // Path-only or hash-only links are safe — no protocol to worry about.
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : '#';
  } catch {
    return '#';
  }
}
