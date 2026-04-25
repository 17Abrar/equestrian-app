/**
 * Returns `url` iff it is a safe same-origin path; otherwise `null`.
 *
 * Used to validate the `redirect_url` query param before passing it to
 * Clerk's `forceRedirectUrl`. Without this defence a phishing link of the
 * form `/sign-in?redirect_url=https://evil.com` would land the user on an
 * attacker-controlled page immediately after a successful sign-in on
 * cavaliq.com — the user trusts the URL bar through the auth handshake
 * and never sees the cross-origin hop.
 *
 * Rules — the URL must:
 *   - start with `/`           (relative path on the current origin)
 *   - NOT start with `//`      (protocol-relative URLs escape origin)
 *   - NOT contain `\`          (some browsers normalise `\` to `/`,
 *                               so `/\evil.com` could become `//evil.com`)
 */
export function safeSameOriginPath(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/')) return null;
  if (url.startsWith('//')) return null;
  if (url.includes('\\')) return null;
  return url;
}
