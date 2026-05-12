import { redirect } from 'next/navigation';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { type UserRole } from '@equestrian/shared/types';
import { RiderNav } from '@/components/rider/rider-nav';

/** Roles that use the rider portal instead of the admin dashboard */
const RIDER_ROLES: UserRole[] = ['rider', 'parent'];

/**
 * Rider portal layout. Deliberately tolerant of `NO_ORGANIZATION`: a
 * brand-new user who just signed up belongs here, they just haven't joined a
 * stable yet — the rider page renders an empty state with a "Find stables"
 * CTA in that case, instead of bouncing them to /select-org.
 *
 * If the user DOES have a club and their role is admin/manager/coach/etc.,
 * we send them back to `/` so they land on the admin dashboard.
 */
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  try {
    const ctx = await getTenantContext();
    if (!RIDER_ROLES.includes(ctx.orgRole)) {
      redirect('/');
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
      <RiderNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
