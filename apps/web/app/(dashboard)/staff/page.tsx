import { StaffList } from '@/components/staff/staff-list';
import { getTenantContext } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function StaffPage() {
  const ctx = await getTenantContext();
  const canCreate = hasPermission(ctx.orgRole, 'staff:create');
  return <StaffList canCreate={canCreate} />;
}
