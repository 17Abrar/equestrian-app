'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BookingFabProps {
  /** Renders the FAB as a <Link>. Mutually exclusive with onClick. */
  href?: string;
  onClick?: () => void;
  /** Visually hidden — describes the destination/action for screen readers. */
  label: string;
  className?: string;
}

const BASE = 'fixed bottom-20 right-4 z-40 size-14 rounded-full shadow-lg sm:bottom-6 sm:right-6';

export function BookingFab({ href, onClick, label, className }: BookingFabProps) {
  if (href) {
    return (
      <Button asChild size="icon" className={cn(BASE, 'p-0', className)}>
        <Link href={href} aria-label={label}>
          <Plus className="size-6" />
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="icon"
      onClick={onClick}
      className={cn(BASE, 'p-0', className)}
      aria-label={label}
    >
      <Plus className="size-6" />
    </Button>
  );
}
