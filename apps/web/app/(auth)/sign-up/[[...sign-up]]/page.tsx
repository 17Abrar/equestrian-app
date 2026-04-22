import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <SignUp />
      <p className="mt-6 text-sm text-muted-foreground">
        Just here to ride?{' '}
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
