import { redirect } from 'next/navigation';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { type UserRole } from '@equestrian/shared/types';
import { RiderNav } from '@/components/rider/rider-nav';

/**
 * Roles that use the rider portal instead of the admin dashboard.
 *
 * Audit FE (2026-06-07): `horse_owner` joined this list. Its permissions are
 * self-scoped (own horses, own bookings, competitions:read), which the rider
 * portal's `_own` views serve correctly; the admin dashboard 403'd on every
 * call for them. The "Book a lesson" affordance is permission-gated in
 * `RiderNav` and `rider-home` since owners lack `bookings:create`.
 */
const RIDER_ROLES: UserRole[] = ['rider', 'parent', 'horse_owner'];

/**
 * Rider portal layout. Deliberately tolerant of `NO_ORGANIZATION`: a
 * brand-new user who just signed up belongs here, they just haven't joined a
 * stable yet — the rider page renders an empty state with a "Find stables"
 * CTA in that case, instead of bouncing them to /select-org.
 *
 * If the user DOES have a club and their role is admin/manager/coach/etc.,
 * we send them back to `/dashboard` so they land on the admin dashboard.
 * (2026-05-26: admin dashboard moved from `/` to `/dashboard` when the
 * public marketing page took over the root URL.)
 */
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  try {
    const ctx = await getTenantContext();
    if (!RIDER_ROLES.includes(ctx.orgRole)) {
      redirect('/dashboard');
    }
  } catch (error) {
    if (error instanceof TenantError) {
      if (error.code === 'UNAUTHORIZED') {
        redirect('/sign-in');
      }
      // NO_ORGANIZATION, NO_ROLE, CLUB_NOT_FOUND → render the layout anyway
      // and let the page handle the empty state.
      if (
        error.code !== 'NO_ORGANIZATION' &&
        error.code !== 'NO_ROLE' &&
        error.code !== 'CLUB_NOT_FOUND'
      ) {
        throw error;
      }
    } else {
      throw error;
    }
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Audit A11Y-8 (2026-06-07): skip link past the nav on every route. */}
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:border focus:px-4 focus:py-2 focus:shadow focus:ring-2 focus:outline-none"
      >
        Skip to content
      </a>
      <RiderNav />
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
