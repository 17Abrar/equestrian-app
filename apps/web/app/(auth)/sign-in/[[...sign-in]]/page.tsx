import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';
import { safeSameOriginPath } from '@/lib/safe-redirect';

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

  // Defence in depth: only honour `redirect_url` when it's a same-origin path.
  // Clerk's allowed-origins list in the dashboard is the first line of
  // defence; this stops an open-redirect even if that allowlist regresses.
  const safeRedirect = safeSameOriginPath(redirect_url);
  const postSignInUrl = safeRedirect ?? (isStable ? '/' : '/rider');

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6" aria-label="Cavaliq home">
        <CavaliqLogo height={32} priority />
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{isStable ? 'Stable sign in' : 'Rider sign in'}</h1>
      <p className="text-muted-foreground mb-6 max-w-sm text-center text-sm">
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
            className="text-muted-foreground hover:text-foreground text-sm font-medium underline-offset-4 hover:underline"
          >
            I&apos;m a rider →
          </Link>
        ) : (
          <Link
            href="/sign-in?as=stable"
            className="text-muted-foreground hover:text-foreground text-sm font-medium underline-offset-4 hover:underline"
          >
            I run a stable →
          </Link>
        )}

        {!isStable && (
          <Link
            href="/discover"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            New here? Browse stables without signing up
          </Link>
        )}
      </div>
    </div>
  );
}
