import * as SecureStore from 'expo-secure-store';
import { type TokenCache } from '@clerk/clerk-expo';

export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      const item = await SecureStore.getItemAsync(key);
      return item;
    } catch {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // SecureStore not available (web or older device)
    }
  },
};
