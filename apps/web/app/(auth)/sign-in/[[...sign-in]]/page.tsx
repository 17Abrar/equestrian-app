import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <SignIn />
      <p className="mt-6 text-sm text-muted-foreground">
        New to Cavaliq?{' '}
        <Link
          href="/discover"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Browse clubs →
        </Link>
      </p>
    </div>
  );
}
