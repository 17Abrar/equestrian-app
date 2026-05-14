import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

/**
 * Audit 2026-05-13 (P1): root branded 404. Previously `notFound()` calls (e.g.
 * `app/c/[slug]/page.tsx:32`) fell back to the unstyled Next.js default 404.
 * This shell matches the public-page chrome (Discover header) and gives
 * visitors a way back to the discovery flow rather than a dead end.
 */
export default function NotFound() {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Cavaliq home">
            <CavaliqLogo height={28} />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <Compass className="text-muted-foreground h-12 w-12" />
        <h1 className="mt-6 text-2xl font-bold sm:text-3xl">Page not found</h1>
        <p className="text-muted-foreground mt-3 max-w-md text-sm">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. If you followed a
          link to a stable, it may have gone private.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/discover">Browse stables</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
