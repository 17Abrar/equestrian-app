import { useAuth } from '@clerk/clerk-expo';
import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '@equestrian/api-client';
import { captureMobileException } from './sentry';

// `EXPO_PUBLIC_*` is statically inlined at bundle time. A release build with
// the env var unset previously fell through to `http://localhost:3000` — on a
// customer phone that resolves to the device itself, so every request silently
// timed out. Fail loud in non-dev instead. Dev keeps the localhost convenience.
function resolveApiBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:3000' : undefined);
  if (!url) {
    throw new Error('EXPO_PUBLIC_API_URL is required for production builds');
  }
  return url;
}

// Audit pass-6 (2026-05-22 LOW-2): exported so screens that fall outside
// the `useApiClient()` hook (e.g. `app/delete-account.tsx`, which uses a
// raw `fetch` because the API client doesn't yet model the
// /v1/account/delete endpoint) can share the same fail-loud guard
// instead of duplicating a `?? 'http://localhost:3000'` fallback that
// would silently target the device's loopback in a release build.
export const API_BASE_URL = resolveApiBaseUrl();

export function useApiClient(): ApiClient {
  const { getToken } = useAuth();

  // Audit pass-5 LOW-4 (2026-05-21): `getOrganizationId` was wired
  // through to set an `X-Organization-Id` request header, but the
  // server never read it — tenant resolution uses Clerk `auth().orgId`
  // and the active-club cookie, both server-side. The dead plumbing
  // misled mobile consumers who assumed picking a Clerk org in the app
  // would steer the API at the selected club; dropping it removes that
  // false signal without changing behavior.
  return useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => getToken(),
        // Audit F-49 (2026-05-08 r6): forward to Sentry via the
        // mobile wiring in `lib/sentry.ts`. The console.error stays
        // as a backstop for the no-DSN dev path so the device console
        // still surfaces the failure during local development.
        onError: (error, context) => {
          captureMobileException(error, 'api_client_error', {
            code: context.code,
            path: context.path,
          });
          // eslint-disable-next-line no-console
          console.error('[api-client]', context.code, context.path, error);
        },
      }),
    [getToken],
  );
}
