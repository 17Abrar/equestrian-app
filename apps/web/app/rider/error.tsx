'use client';

import { AlertCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface RiderErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Audit 2026-05-13 (P1): rider-portal segment error boundary. Previously only
 * `(dashboard)/error.tsx` existed, so an uncaught throw inside any rider
 * screen bubbled all the way to `global-error.tsx` — which replaces the
 * whole HTML shell and discards the rider tab bar. This boundary keeps
 * the rider in their navigation context.
 *
 * Mirrors `(dashboard)/error.tsx`:
 * - Sentry.captureException on every error
 * - Never render `error.message` in production (only the digest)
 * - Provide a reset() button
 */
export default function RiderError({ error, reset }: RiderErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div role="alert" className="flex flex-col items-center justify-center py-24">
      <AlertCircle className="text-destructive h-12 w-12" />
      <h2 className="mt-4 text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-center text-sm">
        {isDev && error.message
          ? error.message
          : 'We hit a snag loading this screen. Please try again.'}
      </p>
      {error.digest && (
        <p className="text-muted-foreground mt-1 text-xs">Error ID: {error.digest}</p>
      )}
      <Button variant="outline" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
