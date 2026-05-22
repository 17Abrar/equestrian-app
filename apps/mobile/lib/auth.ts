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
  // Audit pass-6 (2026-05-22 LOW-1): without an explicit clearToken,
  // Clerk's signOut() left the previously-saved JWT material in
  // SecureStore until the next saveToken overwrote it on a fresh
  // sign-in. The server has already revoked the session by then, but
  // defense-in-depth says: when the user asks to be signed out, scrub
  // the credential at rest. Errors are swallowed (after Sentry capture)
  // because Clerk's sign-out flow shouldn't block on a SecureStore
  // delete that may legitimately race a keychain lock.
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      captureMobileException(err, 'clerk_token_cache_clear_failed', { key });
      // eslint-disable-next-line no-console
      console.error('[clerk-token-cache] clearToken failed', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
