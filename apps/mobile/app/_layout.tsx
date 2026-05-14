import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/clerk-expo';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Sentry from '@sentry/react-native';
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

  const inAuthGroup = segments[0] === '(auth)';
  // Audit 2026-05-13 (P1): wait for the guard invariant to hold before
  // mounting the route tree. Previously `<Slot />` rendered the requested
  // route first, then the effect ran and triggered a `router.replace` —
  // the protected screen flashed, its queries fired (each landing as a
  // 401), and the user saw a brief moment of unauth content. Render a
  // null shell while the guard catches up.
  const guardSatisfied =
    isLoaded && ((isSignedIn && !inAuthGroup) || (!isSignedIn && inAuthGroup));

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isSignedIn, isLoaded, inAuthGroup, router]);

  if (!guardSatisfied) {
    return <View style={{ flex: 1, backgroundColor: '#0d1f34' }} />;
  }

  return <Slot />;
}

/**
 * Audit 2026-05-13 (P1): fallback rendered if a render error escapes every
 * screen-level boundary. Without this the entire app showed a red box in
 * dev / frozen white screen in release.
 */
function ErrorFallback({ resetError }: { resetError: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ color: '#6b7280', marginBottom: 24, textAlign: 'center' }}>
        We hit an unexpected error. Please try again — if the issue persists, restart the app.
      </Text>
      <Pressable
        onPress={resetError}
        accessibilityRole="button"
        style={{
          backgroundColor: '#171717',
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '500' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootLayout() {
  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback resetError={resetError} />}>
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
    </Sentry.ErrorBoundary>
  );
}

// Audit 2026-05-13 (P1): `Sentry.wrap(RootLayout)` instruments the React tree
// for navigation breadcrumbs and Profiler timings. Production stack traces
// now include the screen the rider was on when the error fired.
export default Sentry.wrap(RootLayout);
