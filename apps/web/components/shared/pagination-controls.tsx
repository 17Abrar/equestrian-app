import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  /** Receives the next page number, so a `useState` `setPage` fits as-is. */
  onChange: (next: number) => void;
  /** Extra wrapper classes (e.g. `pt-4` where the parent has no `space-y-*`). */
  className?: string;
}

// Hoisted from finances-page.tsx (where this started life as a local helper)
// because the identical Previous / "Page X of Y" / Next footer had been
// hand-copied into seven list components (bookings, horses, riders, owners,
// staff, competitions, email sends). The copies only differed in attribute
// order and a redundant `Math.max(1, p - 1)` guard: the Previous button is
// already disabled at page 1, so the clamp could never fire. One source of
// truth keeps the disabled-state behavior from drifting per page.
//
// Renders nothing when there's a single page, so callers don't need to gate
// it behind their own `totalPages > 1` check.
export function PaginationControls({
  page,
  totalPages,
  onChange,
  className,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-muted-foreground text-sm">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
