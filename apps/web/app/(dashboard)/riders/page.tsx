import { RidersList } from '@/components/riders/riders-list';
import { getTenantContext } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function RidersPage() {
  const ctx = await getTenantContext();
  const canCreate = hasPermission(ctx.orgRole, 'riders:create');
  return <RidersList canCreate={canCreate} />;
}
