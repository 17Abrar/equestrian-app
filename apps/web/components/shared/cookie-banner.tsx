'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'cavaliq.cookie-notice.dismissed';
const CURRENT_VERSION = '1';

/**
 * Lightweight cookie notice. Cavaliq only sets strictly-necessary cookies
 * today (Clerk session, Cloudflare bot management, our own preferences),
 * so this is an informational banner — no granular consent picker. If we
 * ever introduce analytics or marketing cookies, swap this for a full
 * consent component that gates the non-essential vendors.
 *
 * The dismissal is stored in localStorage with a version key so future
 * material changes can re-prompt without resetting browser cookies.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== CURRENT_VERSION) {
        setVisible(true);
      }
    } catch {
      // localStorage can throw in private-mode Safari, in an iframe with a
      // blocked storage origin, or when storage quota is exceeded. Failing
      // open (no banner) is acceptable; we don't want a quota error to
      // crash every page load.
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // see note in useEffect; failing silently is fine.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-4">
      <div
        role="region"
        aria-label="Cookie notice"
        className="pointer-events-auto bg-background ring-border/80 max-w-2xl rounded-xl border p-4 shadow-lg ring-1 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <Cookie className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="text-foreground font-medium">We use a small set of essential cookies</p>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              Cavaliq sets cookies needed for authentication and security — for example, to keep
              you signed in. We don&rsquo;t use advertising or cross-site tracking cookies. Read
              the{' '}
              <Link href="/legal/cookies" className="text-foreground underline">
                cookie policy
              </Link>{' '}
              for details, or our{' '}
              <Link href="/legal/privacy" className="text-foreground underline">
                privacy policy
              </Link>{' '}
              for the full picture.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={dismiss}>
                Got it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                asChild
                className="text-muted-foreground hover:text-foreground"
              >
                <Link href="/legal/cookies">More info</Link>
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground -m-1 p-1"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
