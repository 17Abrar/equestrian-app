import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';
import { safeSameOriginPath } from '@/lib/safe-redirect';

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

  // Defence in depth: only honour `redirect_url` when it's a same-origin path.
  // See sign-in/page.tsx for rationale.
  const safeRedirect = safeSameOriginPath(redirect_url);
  const postSignUpUrl = safeRedirect ?? (isStable ? '/onboarding' : '/rider');

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6" aria-label="Cavaliq home">
        <CavaliqLogo height={32} priority />
      </Link>

      <h1 className="mb-1 text-2xl font-bold">
        {isStable ? 'Start your stable' : 'Join as a rider'}
      </h1>
      <p className="text-muted-foreground mb-6 max-w-sm text-center text-sm">
        {isStable
          ? 'Create your account — the next step is the stable setup wizard (horses, staff, pricing).'
          : 'Create your account — the next step is browsing stables to join.'}
      </p>

      <SignUp
        forceRedirectUrl={postSignUpUrl}
        signInUrl={isStable ? '/sign-in?as=stable' : '/sign-in'}
      />

      <p className="text-muted-foreground mt-4 max-w-sm text-center text-xs leading-relaxed">
        By creating an account, you agree to our{' '}
        <Link
          href={isStable ? '/legal/terms' : '/legal/terms/end-user'}
          className="hover:text-foreground underline underline-offset-2"
        >
          {isStable ? 'Terms of Service' : 'end-user terms'}
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="hover:text-foreground underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>

      <div className="mt-6 flex flex-col items-center gap-2">
        {isStable ? (
          <Link
            href="/sign-up"
            className="text-muted-foreground hover:text-foreground text-sm font-medium underline-offset-4 hover:underline"
          >
            I&apos;m a rider →
          </Link>
        ) : (
          <Link
            href="/sign-up?as=stable"
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
            Browse stables without signing up
          </Link>
        )}
      </div>
    </div>
  );
}
