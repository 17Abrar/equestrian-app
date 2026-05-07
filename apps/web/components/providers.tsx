'use client';

import { useEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { getQueryClient } from '@/lib/query-client';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Audit r5 F-33 (2026-05-07): the dashboard QueryClient is a browser-
 * session singleton; `<OrganizationSwitcher>` does NOT clear it on org
 * change, and TanStack Query keys (`['horses', filters]`, etc.) are
 * NOT partitioned by clubId. Result: after switching from Club A to
 * Club B, Club A's cached horses/bookings/finances data is served
 * from cache for up to 30s (default staleTime) before TanStack
 * revalidates — a brief tenant-data leak in the UI.
 *
 * The fix: at the Providers boundary, watch Clerk's `orgId`. On the
 * first render `prevOrgIdRef.current` is undefined; we record but do
 * NOT clear (clearing on initial mount would tear down freshly-issued
 * server-component data). On any SUBSEQUENT change of orgId, clear
 * the entire cache. Riders (`rider-nav.tsx`) already do this manually
 * on club switch via `queryClient.clear()`; this listener generalises
 * the behaviour to every dashboard query, including hooks that don't
 * exist yet.
 *
 * Path-(b) chosen over path-(a) (per-key clubId): single 8-line change
 * here covers every existing AND future query key without touching
 * 30+ hooks.
 */
function OrgChangeQueryReset() {
  const { orgId, isLoaded } = useAuth();
  const queryClient = getQueryClient();
  const prevOrgIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const next = orgId ?? null;
    const prev = prevOrgIdRef.current;
    // Initial render: record but DO NOT clear. The freshly-mounted
    // app is already showing the right tenant.
    if (prev === undefined) {
      prevOrgIdRef.current = next;
      return;
    }
    if (prev !== next) {
      queryClient.clear();
      prevOrgIdRef.current = next;
    }
  }, [orgId, isLoaded, queryClient]);

  return null;
}

export function Providers({ children }: ProvidersProps) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <OrgChangeQueryReset />
      {children}
    </QueryClientProvider>
  );
}
