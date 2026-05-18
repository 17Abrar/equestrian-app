import { redirect } from 'next/navigation';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { AccountSetupPlaceholder } from '@/components/onboarding/account-setup-placeholder';
import { AccessRevokedPlaceholder } from '@/components/onboarding/access-revoked-placeholder';

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
      if (error.code === 'NO_MEMBERSHIP') {
        // Defense-in-depth for the Clerk-webhook-race scenario described
        // in tenant.ts (path 1, scenario 1). Self-signup goes through
        // /start-club → /api/v1/clubs/bootstrap which writes the
        // `club_members` row synchronously, so this branch should
        // virtually never fire for that flow. It still catches the case
        // where an invited member or a directly-URL-typed visit lands
        // here while their `organizationMembership.created` Svix event
        // is in flight. Without this branch the throw bubbled into the
        // RSC boundary and Sentry logged it as an unhandled error.
        return <AccountSetupPlaceholder />;
      }
      if (error.code === 'MEMBERSHIP_DEACTIVATED') {
        // Permanent — the membership row exists with `is_active=false`.
        // No amount of polling will resolve it. Render the access-
        // revoked surface with a sign-out affordance instead.
        return <AccessRevokedPlaceholder />;
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
