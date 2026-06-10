'use client';

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Audit TOUR-2 (2026-06-07): a tiny contextual-help affordance, an info icon
 * that reveals a one-line explanation on hover/focus/tap. Use it next to any
 * label whose meaning is not self-evident (capacity, duration, internal ids).
 */
export function InfoHint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
