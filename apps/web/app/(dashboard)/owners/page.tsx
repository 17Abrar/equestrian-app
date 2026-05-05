import { OwnersList } from '@/components/owners/owners-list';
import { getTenantContext } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function OwnersPage() {
  // The Add Owner endpoint requires `owners:create`; mirror the gate
  // here so non-admins (coaches, etc.) don't see a 403-bound button.
  const ctx = await getTenantContext();
  const canCreate = hasPermission(ctx.orgRole, 'owners:create');
  return <OwnersList canCreate={canCreate} />;
}
