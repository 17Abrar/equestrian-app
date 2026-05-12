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
      <body className="bg-background flex min-h-screen items-center justify-center font-sans">
        <div role="alert" className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground mt-2">
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p className="text-muted-foreground mt-1 text-xs">Error ID: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-6 rounded-lg px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
