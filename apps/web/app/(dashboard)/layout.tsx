import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/sidebar';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { type UserRole } from '@equestrian/shared/types';

/**
 * Roles that can access the admin/staff dashboard.
 *
 * Audit FE (2026-06-07): `horse_owner` was removed. Its permission set is
 * entirely self-scoped (`horses:read_own`, `bookings:read_own`,
 * `competitions:read`), so it holds none of the `dashboard:read` / `horses:read`
 * / `bookings:read` grants the admin pages require. Routed here, an owner hit a
 * dashboard that 403'd on every data call. They now use the rider portal
 * (`RIDER_ROLES`), whose own-scoped views match their permissions.
 */
const DASHBOARD_ROLES: UserRole[] = [
  'club_admin',
  'club_manager',
  'coach',
  'groom',
  'veterinarian',
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let ctx;

  try {
    ctx = await getTenantContext();
  } catch (error) {
    if (error instanceof TenantError) {
      if (error.code === 'UNAUTHORIZED') {
        redirect('/sign-in');
      }
      if (error.code === 'NO_ORGANIZATION' || error.code === 'CLUB_NOT_FOUND') {
        // NO_ORGANIZATION: signed-in user with no club memberships.
        // CLUB_NOT_FOUND: defence-in-depth — `getTenantContext` no longer
        // throws this since 2026-04-25 (it falls through to the membership
        // lookup), but `rider/layout.tsx` and `rider/page.tsx` still handle
        // it the same way; mirror that here so a regression in tenant.ts
        // can't 500 the whole dashboard.
        // Both land on /rider to see the "find a stable" empty state.
        // Admins who want to start a club click through from there into
        // /onboarding.
        redirect('/rider');
      }
    }
    throw error;
  }

  if (!DASHBOARD_ROLES.includes(ctx.orgRole)) {
    redirect('/rider');
  }

  // Redirect club admins to onboarding if not completed
  if (!ctx.onboardingCompleted && ctx.orgRole === 'club_admin') {
    redirect('/onboarding');
  }

  return (
    <div className="flex min-h-screen">
      {/* Audit A11Y-8 (2026-06-07): skip link so keyboard users bypass the
          sidebar on every route. Visually hidden until focused. */}
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:border focus:px-4 focus:py-2 focus:shadow focus:ring-2 focus:outline-none"
      >
        Skip to content
      </a>
      <Sidebar role={ctx.orgRole} />
      <main id="main" className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
