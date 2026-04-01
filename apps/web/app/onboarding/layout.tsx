import { redirect } from 'next/navigation';
import { getTenantContext, TenantError } from '@/lib/tenant';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
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

  // If onboarding is already done, go to dashboard
  if (ctx.onboardingCompleted) {
    redirect('/');
  }

  // Only club admins can complete onboarding
  if (ctx.orgRole !== 'club_admin') {
    redirect('/rider');
  }

  return <>{children}</>;
}
