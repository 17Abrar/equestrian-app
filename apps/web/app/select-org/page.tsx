import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

/**
 * Landing for signed-in users with no club membership. The dashboard layout
 * redirects here when `getTenantContext` fails with NO_ORGANIZATION. We nudge
 * the visitor toward /discover (browse clubs as a rider) or /onboarding
 * (start their own club). Replaces the old Clerk OrganizationList — Cavaliq
 * uses its own club_members table, not Clerk Organizations, so that widget was
 * misleading.
 */
export default function SelectOrgPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Cavaliq home">
            <CavaliqLogo height={32} priority />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome to Cavaliq
          </h1>
          <p className="mt-2 text-muted-foreground">
            You&apos;re signed in — pick how you want to use the platform.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Search className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Ride at a club</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Browse clubs near you, join one (or many), and start booking lessons.
                  Your progress follows you across clubs.
                </p>
              </div>
              <Button className="w-full" asChild>
                <Link href="/discover">Browse clubs</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Run your own club</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Manage horses, riders, staff, and bookings from one dashboard. Get paid
                  via Stripe, N-Genius, or Ziina.
                </p>
              </div>
              <Button className="w-full" variant="outline" asChild>
                {/* /onboarding's layout requires an existing club. The
                    bridge page at /start-club creates the Clerk
                    organization first, waits for the
                    organization.created webhook to populate our
                    `clubs` row, then forwards to /onboarding. */}
                <Link href="/start-club">Start a club</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Already joined a club but not seeing it? Try signing out and back in.
        </p>
      </main>
    </div>
  );
}
