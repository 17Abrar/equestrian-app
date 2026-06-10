'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Audit TOUR-1/TOUR-2 (2026-06-07): the app had zero in-app guidance, so a
 * first-time rider landing on the booking screen had to figure the flow out
 * alone. This is a dependency-free first-run product tour. It deliberately
 * avoids getBoundingClientRect spotlight math (fragile across layouts and the
 * Cloudflare/OpenNext runtime) in favour of a robust scroll-into-view plus a
 * highlight ring on the current target, driven by a fixed coach card. It is a
 * client-only component, mounted inside an existing 'use client' boundary, so
 * no tour code ever runs on the Worker.
 *
 * Targets are matched by a `data-tour="<id>"` attribute on the element to
 * highlight. A step with no target renders a centered intro/outro card.
 */

export interface TourStep {
  /** `data-tour` value of the element to highlight. Omit for an intro/outro card. */
  target?: string;
  title: string;
  body: string;
}

interface FirstRunTourProps {
  steps: TourStep[];
  /** localStorage key; once set, the tour never auto-starts again. */
  storageKey: string;
  /**
   * Only auto-start once this is true (e.g. data has loaded and the anchored
   * elements are actually in the DOM). Defaults to true.
   */
  enabled?: boolean;
}

// Written as one literal string so Tailwind's source scanner generates each
// utility; applied to the live target element via classList.
const HIGHLIGHT_CLASSES =
  'ring-2 ring-primary ring-offset-2 ring-offset-background rounded-lg transition-shadow';

function readCompleted(storageKey: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(storageKey) === '1';
  } catch {
    // Private mode / storage disabled: treat as not-yet-shown but do not throw.
    return false;
  }
}

function writeCompleted(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, '1');
  } catch {
    // Best-effort: if storage is unavailable the tour simply may show again.
  }
}

export function FirstRunTour({ steps, storageKey, enabled = true }: FirstRunTourProps) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  // Auto-start once, when enabled and not previously completed.
  useEffect(() => {
    if (!enabled || steps.length === 0) return;
    if (readCompleted(storageKey)) return;
    setIndex(0);
    setActive(true);
  }, [enabled, steps.length, storageKey]);

  const finish = useCallback(() => {
    writeCompleted(storageKey);
    setActive(false);
  }, [storageKey]);

  // Highlight + scroll the current target; clean up on step change / unmount.
  useEffect(() => {
    if (!active) return;
    const step = steps[index];
    const selector = step?.target ? `[data-tour="${step.target}"]` : null;
    const el = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (!el) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
    const added = HIGHLIGHT_CLASSES.split(' ');
    el.classList.add(...added);
    return () => {
      el.classList.remove(...added);
    };
  }, [active, index, steps]);

  // Escape closes the tour.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);

  if (!active || steps.length === 0) return null;
  const step = steps[index];
  if (!step) return null;

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Getting started tour"
      className="fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-sm sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2"
    >
      <div className="bg-card relative rounded-xl border p-4 shadow-lg">
        <button
          type="button"
          onClick={finish}
          aria-label="Skip tour"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-3 right-3 rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-muted-foreground text-xs font-medium">
          Step {index + 1} of {steps.length}
        </p>
        <h3 className="mt-1 pr-6 text-sm font-semibold">{step.title}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{step.body}</p>

        {/* Progress dots */}
        <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'bg-primary w-4' : 'bg-muted w-1.5',
              )}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          <div className="flex gap-2">
            {!isFirst && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}
            <Button
              size="sm"
              autoFocus
              onClick={() => {
                if (isLast) finish();
                else setIndex((i) => Math.min(steps.length - 1, i + 1));
              }}
            >
              {isLast ? (
                <>
                  Got it
                  <Check className="ml-1 h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
