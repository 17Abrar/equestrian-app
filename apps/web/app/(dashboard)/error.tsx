'use client';

import { AlertCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Audit HIGH-6 (2026-05-05): never render `error.message` in production.
// Next.js scrubs server-component error messages on prod builds, but
// client-component throws (an exception in a 'use client' tree) come
// through with their original `.message` intact — including any
// stack-bearing strings, DB errors, or Clerk diagnostic text. The
// `(dashboard)` boundary previously surfaced it directly; mirror
// `global-error.tsx` and show only `error.digest` (the random
// identifier Next.js assigns and logs server-side).
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Dev-only escape hatch: in development, the inline message is helpful.
  // Production: only the digest, never the message.
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div role="alert" className="flex flex-col items-center justify-center py-24">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <h2 className="mt-4 text-xl font-semibold">Something went wrong</h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        {isDev && error.message
          ? error.message
          : 'An unexpected error occurred while loading this page.'}
      </p>
      {error.digest && (
        <p className="mt-1 text-xs text-muted-foreground">Error ID: {error.digest}</p>
      )}
      <Button variant="outline" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
