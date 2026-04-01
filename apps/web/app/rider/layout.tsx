import { redirect } from 'next/navigation';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { type UserRole } from '@equestrian/shared/types';
import { RiderNav } from '@/components/rider/rider-nav';

/** Roles that use the rider portal instead of the admin dashboard */
const RIDER_ROLES: UserRole[] = ['rider', 'parent'];

export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  let ctx;

  try {
    ctx = await getTenantContext();
  } catch (error) {
    if (error instanceof TenantError) {
      if (error.code === 'UNAUTHORIZED') {
        redirect('/sign-in');
      }
      if (error.code === 'NO_ORGANIZATION') {
        redirect('/select-org');
      }
    }
    throw error;
  }

  if (!RIDER_ROLES.includes(ctx.orgRole)) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-background">
      <RiderNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
