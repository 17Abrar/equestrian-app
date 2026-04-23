import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { Compass } from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ as?: string }>;
}

/**
 * Default view is framed as "Rider sign in" because most traffic is riders
 * coming in from /discover. Stable owners hit `?as=stable` (via the secondary
 * link under the card) which switches the header/copy. Same Clerk widget,
 * same auth — purely presentational.
 */
export default async function SignInPage({ searchParams }: PageProps) {
  const { as } = await searchParams;
  const isStable = as === 'stable';

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
          ? 'Sign in to manage your stable, horses, staff, and bookings.'
          : 'Sign in to book lessons, track your progress, and join stables.'}
      </p>

      <SignIn />

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
