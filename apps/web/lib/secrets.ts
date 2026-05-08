/**
 * Audit F-40 (2026-05-08 r6): typed accessor for Worker secrets.
 *
 * Cloudflare's `wrangler secret put` injects secrets into `process.env`
 * at runtime, but `cloudflare-env.d.ts:35` only enumerates the `vars`
 * keys — secrets are intentionally excluded from the auto-generated
 * `ProcessEnv` interface (their presence at type-time would tempt
 * leaky logging). The trade-off is that direct `process.env.FOO`
 * access for a secret name is typed as `string | undefined` for any
 * key, including typos: `process.env.PLATFORM_ZINNA_API_KEY` (note
 * the missing "i") compiles cleanly and silently returns `undefined`.
 *
 * `getSecret(name)` constrains `name` to a documented union of valid
 * secret keys, so a typo surfaces as a TS error at the call site.
 *
 * The list below enumerates secrets set via `wrangler secret put`. If
 * you add a new secret to Wrangler, ALSO add it here. If a new env var
 * lives in `wrangler.jsonc` `vars` (non-secret config like region or
 * feature flags), it will appear in `cloudflare-env.d.ts` and should
 * be accessed via the auto-generated `ProcessEnv` shape — NOT this
 * helper (which is reserved for true secrets).
 */

// Worker secret names. Sourced from `DEPLOY.md` + `wrangler secret list cavaliq`.
// Keep alphabetized; each entry should be load-bearing (a typo would
// silently break a feature). Optional secrets are included — `getSecret`
// returns `string | undefined` so a missing-but-recognized key is fine.
type SecretName =
  | 'CLERK_SECRET_KEY'
  | 'CLERK_WEBHOOK_SECRET'
  | 'CRON_SECRET'
  | 'EMAIL_FROM'
  | 'ENCRYPTION_KEY'
  | 'NEXT_PUBLIC_SENTRY_DSN'
  | 'PLATFORM_ZIINA_API_KEY'
  | 'PLATFORM_ZIINA_TEST_MODE'
  | 'PLATFORM_ZIINA_WEBHOOK_SECRET'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_BUCKET_NAME'
  | 'R2_ENDPOINT'
  | 'R2_PUBLIC_URL'
  | 'R2_SECRET_ACCESS_KEY'
  | 'RESEND_API_KEY'
  | 'SENTRY_DSN'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'UPSTASH_REDIS_REST_URL'
  | 'WEBHOOK_STALE_AFTER_MS';

export function getSecret(name: SecretName): string | undefined {
  return process.env[name];
}

/**
 * Variant that throws when the secret is missing. Use for paths that
 * cannot proceed without the secret (e.g. encryption-at-rest key,
 * cron-secret comparator). Mirrors `assertEncryptionKeyConfigured`'s
 * throw policy in `packages/db/src/crypto.ts`.
 */
export function requireSecret(name: SecretName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`requireSecret: ${name} is not set`);
  }
  return value;
}
