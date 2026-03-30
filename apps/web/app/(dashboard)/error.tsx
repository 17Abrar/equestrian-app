'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-24">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <h2 className="mt-4 text-xl font-semibold">Something went wrong</h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred while loading this page.'}
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
