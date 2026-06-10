'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Check, X, Rocket } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Audit TOUR-1 (2026-06-07): after onboarding, an admin landed on a generic
 * "Welcome" with no pointer to the real activation step. The wizard creates
 * arenas and lesson types but no calendar slots, and a club is not bookable
 * until slots exist. This dismissible checklist teaches that, driven entirely
 * by data the dashboard already fetches (no extra request). Items self-resolve
 * when their condition is met; the whole card disappears once all are done or
 * the admin dismisses it.
 */

const DISMISS_KEY_PREFIX = 'cavaliq:getting-started:dismissed:v1';

interface GettingStartedChecklistProps {
  /** True once any slots exist (today's slots or any booking implies slots). */
  hasSlots: boolean;
  horseCount: number;
  riderCount: number;
}

export function GettingStartedChecklist({
  hasSlots,
  horseCount,
  riderCount,
}: GettingStartedChecklistProps) {
  // Codex review (2026-06-07): scope dismissal per club so dismissing for one
  // stable does not hide the checklist for every other stable in this browser.
  const { orgId, isLoaded } = useAuth();
  const dismissKey = `${DISMISS_KEY_PREFIX}:${orgId ?? 'anon'}`;

  // Render nothing until the client has read the dismissal flag (after auth
  // resolves so the key is scoped), so server and first client paint agree (no
  // hydration mismatch). Mirrors cookie-banner.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!isLoaded) return;
    try {
      setVisible(window.localStorage.getItem(dismissKey) !== '1');
    } catch {
      setVisible(true);
    }
  }, [isLoaded, dismissKey]);

  const items = [
    {
      id: 'slots',
      label: 'Create your first calendar slots',
      hint: 'Riders can only book once your week has open slots. This is the step that makes your stable bookable.',
      href: '/calendar',
      done: hasSlots,
    },
    {
      id: 'horses',
      label: 'Add your horses',
      hint: 'Add the horses riders are matched to when they book.',
      href: '/horses',
      done: horseCount > 0,
    },
    {
      id: 'riders',
      label: 'Invite your riders',
      hint: 'Add riders so they can book lessons and pay online.',
      href: '/riders',
      done: riderCount > 0,
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  function dismiss() {
    try {
      window.localStorage.setItem(dismissKey, '1');
    } catch {
      // best-effort
    }
    setVisible(false);
  }

  if (!visible || allDone) return null;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Rocket className="text-primary h-5 w-5" />
            <h2 className="text-lg font-semibold">Get your stable live</h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss getting started checklist"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {doneCount} of {items.length} done. Finish these to start taking bookings.
        </p>

        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                  item.done ? 'opacity-70' : 'hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border',
                    item.done
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/40',
                  )}
                  aria-hidden="true"
                >
                  {item.done ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', item.done && 'line-through')}>
                    {item.label}
                  </span>
                  {!item.done && (
                    <span className="text-muted-foreground block text-xs leading-relaxed">
                      {item.hint}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
