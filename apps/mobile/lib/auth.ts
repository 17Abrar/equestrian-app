import * as SecureStore from 'expo-secure-store';
import { type TokenCache } from '@clerk/clerk-expo';
import { captureMobileException } from './sentry';

/**
 * Clerk token cache backed by Expo SecureStore. The earlier implementation
 * had two correctness bugs (audit D-3):
 *
 *  - `getToken` swallowed every error AND deleted the credential on read
 *    failure. iOS keychain locks (cold-start before Face ID, app resume
 *    from background) throw — the right behaviour is "try again later",
 *    not "wipe the token and silently sign the user out."
 *
 *  - `saveToken` swallowed every error with a comment claiming
 *    "SecureStore not available." On any device that runs Clerk-Expo
 *    SecureStore IS available; a real failure means the token was minted
 *    but never persisted, producing a successful-sign-in-then-immediate-
 *    sign-out loop with no diagnostic.
 *
 * Now: errors surface to the JS console (Expo + dev tools pick these up),
 * and `saveToken` re-throws so Clerk treats the partial sign-in as a
 * failure rather than a silent success.
 */
// Audit pass-7 (2026-05-25 MED-3 codex / pass-6 LOW-1 deferred from PR #156):
// the Clerk session JWT is persisted under this key. Hardcoded here so the
// explicit clear path in `apps/mobile/app/_layout.tsx` (sign-out useEffect)
// can wipe it even though `@clerk/clerk-expo@2.x` only invokes the
// `clearToken` cache hook during publishable-key hot-swap, NOT on normal
// `signOut()`. Verified at `createClerkInstance.js:60` — gated by
// `if (hasKeyChanged)`. Without explicit wipe, a shared device retains the
// JWT in the keychain across sign-out → cold start cycles, enabling
// session resurrection.
export const CLERK_SESSION_JWT_KEY = '__clerk_client_jwt';

export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (err) {
      // Audit F-49 (2026-05-08 r6): forward to Sentry. The console.error
      // stays as a backstop for the no-DSN dev path.
      captureMobileException(err, 'clerk_token_cache_get_failed', { key });
      // eslint-disable-next-line no-console
      console.error('[clerk-token-cache] getToken failed', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      // Don't delete — a transient keychain lock self-heals on the next
      // attempt. Clerk treats null as "not signed in" and prompts the user
      // again, which is the right UX for "we couldn't read the token now."
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      // Audit F-49 (2026-05-08 r6): forward to Sentry.
      captureMobileException(err, 'clerk_token_cache_save_failed', { key });
      // eslint-disable-next-line no-console
      console.error('[clerk-token-cache] saveToken failed', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
  // Audit pass-7 (2026-05-25): adding the hook even though @clerk/clerk-expo
  // 2.x only invokes it during publishable-key hot-swap. Forward-compat for
  // future Clerk versions that may call this on sign-out. The load-bearing
  // sign-out cleanup is in `_layout.tsx` — see `CLERK_SESSION_JWT_KEY` above.
  //
  // Signature is sync (`() => void` per Clerk's `TokenCache` type) so the
  // promise is fire-and-forget — Clerk doesn't await it anyway. Errors flow
  // to Sentry via the `.catch()` tail; sign-out UX is never blocked on the
  // wipe.
  clearToken(key: string): void {
    SecureStore.deleteItemAsync(key).catch((err: unknown) => {
      captureMobileException(err, 'clerk_token_cache_clear_failed', { key });
      // eslint-disable-next-line no-console
      console.error('[clerk-token-cache] clearToken failed', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  },
};
