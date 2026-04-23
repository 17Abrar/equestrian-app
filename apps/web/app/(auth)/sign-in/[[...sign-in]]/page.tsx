import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { Compass } from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ as?: string; redirect_url?: string }>;
}

/**
 * Two sign-in paths that differ by post-auth destination:
 *
 *   /sign-in            → rider. Lands on /rider (rider portal home).
 *   /sign-in?as=stable  → stable owner. Lands on /, which the dashboard
 *                         layout renders as the admin overview.
 *
 * If the user's actual role doesn't match where the URL sends them — e.g.
 * a rider clicks "I run a stable" and signs in — the dashboard layout
 * bounces them to the right place (/rider for riders, / for admins).
 * So the URL is a *hint* about intent, not a hard gate: nobody gets locked
 * out of their actual portal.
 *
 * `?redirect_url=` from e.g. /c/[slug] always wins.
 */
export default async function SignInPage({ searchParams }: PageProps) {
  const { as, redirect_url } = await searchParams;
  const isStable = as === 'stable';

  const postSignInUrl = redirect_url ?? (isStable ? '/' : '/rider');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 text-base font-semibold text-muted-foreground hover:text-foreground"
      >
        <Compass className="h-4 w-4" />
        Cavaliq
      </Link>

      <h1 className="mb-1 text-2xl font-bold">
        {isStable ? 'Stable sign in' : 'Rider sign in'}
      </h1>
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        {isStable
          ? 'Sign in to manage your stable — horses, staff, bookings, and payments.'
          : 'Sign in to book lessons, track progress, and join stables.'}
      </p>

      <SignIn
        forceRedirectUrl={postSignInUrl}
        signUpUrl={isStable ? '/sign-up?as=stable' : '/sign-up'}
      />

      <div className="mt-6 flex flex-col items-center gap-2">
        {isStable ? (
          <Link
            href="/sign-in"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            I&apos;m a rider →
          </Link>
        ) : (
          <Link
            href="/sign-in?as=stable"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            I run a stable →
          </Link>
        )}

        {!isStable && (
          <Link
            href="/discover"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            New here? Browse stables without signing up
          </Link>
        )}
      </div>
    </div>
  );
}
