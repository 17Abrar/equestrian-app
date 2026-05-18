'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

const RETRY_INTERVAL_MS = 3000;

/**
 * Holding-pen screen rendered by `/onboarding/layout.tsx` when
 * `getTenantContext()` throws `NO_MEMBERSHIP`. With the synchronous
 * /api/v1/clubs/bootstrap path in place, the self-signup flow no
 * longer hits this — but invited members who land on /onboarding
 * directly during a brief Clerk-webhook delivery hiccup, or users
 * navigating via URL before the membership row has been written,
 * still need a graceful surface.
 *
 * Auto-retries via `router.refresh()` on a 3s interval. The catch
 * branch in the layout returns this component instead of `{children}`;
 * when the membership row appears, the layout no longer throws,
 * `{children}` renders, and this component unmounts (the cleanup
 * function clears the interval).
 */
export function AccountSetupPlaceholder() {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), RETRY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <CavaliqLogo height={32} priority />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-24 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Loader2 className="text-primary h-10 w-10 animate-spin" aria-hidden="true" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Setting up your account…</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            We&apos;re getting things ready. This usually takes a few seconds. The page will refresh
            automatically.
          </p>
          <Button className="mt-6" variant="outline" onClick={() => router.refresh()}>
            Refresh now
          </Button>
        </div>
      </main>
    </div>
  );
}
