import * as SecureStore from 'expo-secure-store';
import { type TokenCache } from '@clerk/clerk-expo';

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
      console.error('[clerk-token-cache] saveToken failed', {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
};
