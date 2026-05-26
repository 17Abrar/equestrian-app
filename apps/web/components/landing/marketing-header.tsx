'use client';

import Link from 'next/link';
import { useUser, UserButton } from '@clerk/nextjs';
import { LayoutDashboard, Menu } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

/**
 * Public-marketing top nav. Renders on `/` for both signed-in and signed-out
 * visitors (the landing page is publicly accessible — see middleware.ts).
 *
 * - Signed out: anchor links to in-page sections, plus Log in / Sign up.
 * - Signed in: same anchor links plus a "Go to dashboard" affordance that
 *   sends them to `/dashboard`. The dashboard layout will bounce riders to
 *   `/rider`, so role detection here is unnecessary — the destination
 *   resolves correctly for every role.
 */
export function MarketingHeader() {
  const { isSignedIn, isLoaded } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Cavaliq home">
          <CavaliqLogo height={28} priority />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Marketing">
          <a
            href="#features"
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            How it works
          </a>
          <a
            href="#faq"
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            FAQ
          </a>
          <Link
            href="/discover"
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            Discover stables
          </Link>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {!isLoaded ? (
            <div className="h-9 w-32" aria-hidden />
          ) : isSignedIn ? (
            <>
              <Button asChild size="sm" variant="default">
                <Link href="/dashboard">
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Go to dashboard
                </Link>
              </Button>
              <UserButton appearance={{ elements: { userButtonTrigger: 'rounded-full' } }} />
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/sign-in?as=stable">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up?as=stable">Start free trial</Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          className="md:hidden"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
            <a
              href="#features"
              onClick={() => setMobileOpen(false)}
              className="hover:bg-muted rounded-md px-3 py-2 text-sm font-medium"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileOpen(false)}
              className="hover:bg-muted rounded-md px-3 py-2 text-sm font-medium"
            >
              How it works
            </a>
            <a
              href="#faq"
              onClick={() => setMobileOpen(false)}
              className="hover:bg-muted rounded-md px-3 py-2 text-sm font-medium"
            >
              FAQ
            </a>
            <Link
              href="/discover"
              onClick={() => setMobileOpen(false)}
              className="hover:bg-muted rounded-md px-3 py-2 text-sm font-medium"
            >
              Discover stables
            </Link>
            <div className="border-t pt-3" />
            {!isLoaded ? null : isSignedIn ? (
              <Button asChild size="sm" className="justify-start">
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Go to dashboard
                </Link>
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href="/sign-in?as=stable" onClick={() => setMobileOpen(false)}>
                    Log in
                  </Link>
                </Button>
                <Button asChild size="sm" className="w-full">
                  <Link href="/sign-up?as=stable" onClick={() => setMobileOpen(false)}>
                    Start free trial
                  </Link>
                </Button>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
