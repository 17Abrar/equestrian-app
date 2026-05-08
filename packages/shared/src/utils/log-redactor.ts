/**
 * Audit F-43 (2026-05-08 r6): redaction logic extracted from
 * `apps/web/lib/logger.ts` so it can be unit-tested in this workspace.
 *
 * Two-layer scrub:
 *
 * 1. **Key-name match** (`SENSITIVE_KEYS`): when a record key (case-
 *    insensitive) matches the denylist, the entire value is replaced
 *    with `[REDACTED]`. Catches `{ email: ... }`, `{ phone: ... }`,
 *    `{ medicalNotes: ... }`, etc.
 *
 * 2. **Value regex** (`PII_PATTERNS`): scrubs PII shapes that appear
 *    inside otherwise-safe string values. Catches
 *    `{ description: 'reach out at rider@example.com' }` even though
 *    `description` itself isn't on the denylist. Patterns are
 *    deliberately conservative — they require email shape, leading
 *    `+CC`, or parenthesized area codes so plain integer ids
 *    (booking numbers, transaction ids) aren't false-positive
 *    redacted.
 *
 * 3. **Free-text bare GCC phones** (`BARE_GCC_PHONE_PATTERN`): a
 *    UAE/GCC bare-digits phone (`0501234567`) looks identical to an
 *    invoice number, so it's only scrubbed when the value's PARENT
 *    KEY is one of the free-text shapes (`note`, `message`,
 *    `comment`, etc.). PHI keys (`description`, `notes`) get whole-
 *    value redaction at layer 1, so they're not in this allowlist.
 *
 * The redactor recurses through arrays and objects up to a depth of
 * `MAX_DEPTH`; deeper nesting is collapsed to `'[nested]'` to bound
 * worst-case work on a malicious / pathological log payload.
 */

const MAX_DEPTH = 5;

export interface RedactorConfig {
  /** Lower-cased keys that always have their value replaced with `[REDACTED]`. */
  sensitiveKeys: ReadonlySet<string>;
  /** Regex patterns scanned across every string value. */
  piiPatterns: ReadonlyArray<{ regex: RegExp; replacement: string }>;
  /** Bare-digits phone pattern that only fires when the parent key is in `freeTextKeys`. */
  bareGccPhonePattern: RegExp;
  /** Lower-cased keys whose values get the bare-digits pattern applied. */
  freeTextKeys: ReadonlySet<string>;
}

export function scrubPiiInString(
  value: string,
  parentKey: string | undefined,
  config: RedactorConfig,
): string {
  let out = value;
  for (const { regex, replacement } of config.piiPatterns) {
    out = out.replace(regex, replacement);
  }
  if (parentKey && config.freeTextKeys.has(parentKey.toLowerCase())) {
    out = out.replace(config.bareGccPhonePattern, '[REDACTED-PHONE]');
  }
  return out;
}

export function sanitize(
  data: unknown,
  config: RedactorConfig,
  depth = 0,
  parentKey?: string,
): unknown {
  if (depth > MAX_DEPTH) return '[nested]';

  if (typeof data === 'string') {
    return scrubPiiInString(data, parentKey, config);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, config, depth + 1, parentKey));
  }

  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (config.sensitiveKeys.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitize(value, config, depth + 1, key);
      }
    }
    return result;
  }

  return data;
}
