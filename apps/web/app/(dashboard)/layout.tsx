import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/sidebar';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { type UserRole } from '@equestrian/shared/types';

/** Roles that can access the admin/staff dashboard */
const DASHBOARD_ROLES: UserRole[] = [
  'club_admin',
  'club_manager',
  'coach',
  'horse_owner',
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
      if (error.code === 'NO_ORGANIZATION') {
        // Riders without a club land on /rider to see the "find a stable"
        // empty state. Admins who want to start a club click through from
        // there into /onboarding.
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
      <Sidebar role={ctx.orgRole} />
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
