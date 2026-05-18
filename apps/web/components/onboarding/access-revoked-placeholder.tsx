'use client';

import { useClerk } from '@clerk/nextjs';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

/**
 * Rendered when `getTenantContext()` throws `MEMBERSHIP_DEACTIVATED`
 * — the user's Clerk session is still active for an org whose
 * `club_members` row has `is_active = false`. Their Clerk JWT may
 * also still carry the old `org:admin` role; tenant.ts already
 * refuses the request on the server side, but the client UX needs
 * to differ from the auto-refreshing `AccountSetupPlaceholder` (the
 * NO_MEMBERSHIP path). Auto-refreshing here would poll forever — the
 * row will not flip back to active on its own.
 *
 * Surfaces the access-revoked state plainly and exposes Clerk sign-out
 * as the recovery path; signing out invalidates the JWT and ends the
 * session.
 */
export function AccessRevokedPlaceholder() {
  const { signOut } = useClerk();

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <CavaliqLogo height={32} priority />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-24 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <ShieldOff className="text-destructive h-10 w-10" aria-hidden="true" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Access revoked</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Your membership in this club has been deactivated by an admin. If you think this is a
            mistake, please contact the club directly.
          </p>
          <Button className="mt-6" onClick={() => signOut({ redirectUrl: '/sign-in' })}>
            Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}
