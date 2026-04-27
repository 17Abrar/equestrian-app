/**
 * Validate a URL for use in email `<Button href>` / `<Link href>` props.
 * React Email auto-escapes text content but does NOT validate URL schemes
 * in href attributes. Without this, a future caller passing a user-derived
 * URL would let `javascript:` / `data:` / `vbscript:` schemes through.
 *
 * Returns `'#'` for anything that isn't a normal http(s) or mailto URL,
 * so the link still renders (no broken markup) but goes nowhere.
 *
 * Also defends against `undefined` rendering as the literal string
 * `"undefined"` if a caller forgets a prop.
 */
export function safeHref(url: string | undefined | null): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      return parsed.toString();
    }
    return '#';
  } catch {
    // Non-absolute URLs (e.g. site-relative paths) aren't really meaningful in
    // an email since there's no base origin — refuse them rather than hand the
    // recipient a broken link to render against their mail client's about:.
    return '#';
  }
}
