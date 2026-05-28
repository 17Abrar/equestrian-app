import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center">{children}</div>
      <footer className="border-border/60 mx-auto w-full max-w-xl border-t px-4 py-4 text-center">
        <ul className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
          <li>
            <Link href="/legal/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
              Privacy
            </Link>
          </li>
          <li>
            <Link href="/legal/terms" className="hover:text-foreground underline-offset-2 hover:underline">
              Terms
            </Link>
          </li>
          <li>
            <Link href="/legal/cookies" className="hover:text-foreground underline-offset-2 hover:underline">
              Cookies
            </Link>
          </li>
          <li>
            <Link href="/support" className="hover:text-foreground underline-offset-2 hover:underline">
              Support
            </Link>
          </li>
        </ul>
      </footer>
    </div>
  );
}
