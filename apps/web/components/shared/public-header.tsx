'use client';

import Link from 'next/link';
import { useUser, UserButton } from '@clerk/nextjs';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

export function PublicHeader() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href={isSignedIn ? '/rider' : '/'} aria-label="Cavaliq home">
          <CavaliqLogo height={32} priority />
        </Link>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/discover">Find a stable</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/help">Help</Link>
          </Button>
          {!isLoaded ? null : isSignedIn ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/rider">
                  <Home className="mr-2 h-4 w-4" />
                  My home
                </Link>
              </Button>
              <UserButton appearance={{ elements: { userButtonTrigger: 'rounded-full' } }} />
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
