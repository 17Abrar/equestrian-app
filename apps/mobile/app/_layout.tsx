import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/clerk-expo';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { tokenCache } from '@/lib/auth';
import { queryClient } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';
import '../global.css';

// Audit F-49 (2026-05-08 r6): Sentry init at module-load so the SDK
// hooks the global error handler before any other module
// initializes. No-op when EXPO_PUBLIC_SENTRY_DSN is unset (dev path).
initSentry();

// Audit pass-4 M-3 (2026-05-10): fail loud if the publishable key is
// missing in the release build, mirroring the EXPO_PUBLIC_API_URL guard
// in `lib/api.ts:11-15`. The previous `!` non-null assertion would let
// `<ClerkProvider>` mount with an empty string and surface a generic
// internal Clerk error far from the actual cause; this throws at import
// time with a clear message that points at the missing env var.
const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error(
    'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. Configure it in `app.config.ts` / `eas.json` for release builds and `.env` for local dev.',
  );
}

function AuthGuard() {
  const { isSignedIn, isLoaded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isSignedIn, isLoaded, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
              <AuthGuard />
              <StatusBar style="auto" />
              {/* Audit F-55 (2026-05-08 Sigma-bis): non-blocking toast for
               * mutation success / warning paths. `Alert.alert` stays for
               * terminal failures that need explicit user acknowledgement
               * (per CLAUDE.md UX standards). Mounted at the root after
               * SafeAreaProvider so the toast respects the safe-area
               * insets and renders above every screen. */}
              <Toast />
            </SafeAreaProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
