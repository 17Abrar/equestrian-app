import Link from 'next/link';
import { Compass, ArrowRight } from 'lucide-react';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RiderHome } from './rider-home';

/**
 * Rider home. Two states:
 *   - With a club → renders the standard bookings dashboard.
 *   - Without a club → shows an empty-state CTA pointing at /discover so the
 *     rider can find and join a stable.
 *
 * Server-rendered tenant check so we don't render a skeleton that would
 * immediately 401 against the bookings API.
 */
export default async function RiderHomePage() {
  let hasClub = false;
  try {
    await getTenantContext();
    hasClub = true;
  } catch (error) {
    if (error instanceof TenantError) {
      if (
        error.code === 'NO_ORGANIZATION' ||
        error.code === 'NO_ROLE' ||
        error.code === 'CLUB_NOT_FOUND'
      ) {
        hasClub = false;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (hasClub) {
    return <RiderHome />;
  }

  return <NoClubEmptyState />;
}

function NoClubEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center sm:py-20">
      <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
        <Compass className="text-primary h-8 w-8" />
      </div>
      <h1 className="mt-6 text-2xl font-bold sm:text-3xl">Find a stable to ride at</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        You&apos;re signed in but haven&apos;t joined a stable yet. Browse the directory to find one
        near you — you can join as many as you like.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/discover">
            Browse stables
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/onboarding">Run your own stable</Link>
        </Button>
      </div>

      <Card className="mt-10 w-full max-w-xl text-left">
        <CardContent className="text-muted-foreground p-6 text-sm">
          <p className="text-foreground font-medium">How this works</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Browse public stables on the directory.</li>
            <li>Tap &ldquo;Join&rdquo; on any open stable to become a member instantly.</li>
            <li>Your bookings, horses, and progress live here — across every stable you join.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
