import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';
import { Compass } from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ as?: string; redirect_url?: string }>;
}

/**
 * Two sign-up paths that differ by what they do AFTER Clerk authentication:
 *
 *   /sign-up            → rider. Redirects to /rider. The rider portal
 *                         shows "Find a stable" empty state + pushes them
 *                         into /discover to join one.
 *
 *   /sign-up?as=stable  → stable owner. Redirects to /onboarding, the
 *                         existing club-setup wizard that creates the
 *                         stable's clubs row and clerk org.
 *
 * An explicit `?redirect_url=` (set by /c/[slug] after tapping Join) always
 * wins — that path bounces riders back to the club profile so they can
 * auto-join right after sign-up.
 */
export default async function SignUpPage({ searchParams }: PageProps) {
  const { as, redirect_url } = await searchParams;
  const isStable = as === 'stable';

  const postSignUpUrl = redirect_url ?? (isStable ? '/onboarding' : '/rider');

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
        {isStable ? 'Start your stable' : 'Join as a rider'}
      </h1>
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        {isStable
          ? 'Create your account — the next step is the stable setup wizard (horses, staff, pricing).'
          : 'Create your account — the next step is browsing stables to join.'}
      </p>

      <SignUp forceRedirectUrl={postSignUpUrl} signInUrl={isStable ? '/sign-in?as=stable' : '/sign-in'} />

      <div className="mt-6 flex flex-col items-center gap-2">
        {isStable ? (
          <Link
            href="/sign-up"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            I&apos;m a rider →
          </Link>
        ) : (
          <Link
            href="/sign-up?as=stable"
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
            Browse stables without signing up
          </Link>
        )}
      </div>
    </div>
  );
}
