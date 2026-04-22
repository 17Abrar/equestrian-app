'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  // Surface any uncaught error in the root layout to Sentry. `useEffect`
  // runs in the browser, which is where Sentry's client SDK is initialized.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background font-sans">
        <div role="alert" className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-muted-foreground">
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p className="mt-1 text-xs text-muted-foreground">Error ID: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
