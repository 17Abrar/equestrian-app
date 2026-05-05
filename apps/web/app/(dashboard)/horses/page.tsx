import { HorsesList } from '@/components/horses/horses-list';
import { getTenantContext } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function HorsesPage() {
  // Audit MED (2026-05-05 pass 2): mirror the server-side `horses:create`
  // gate so the UI hides the button when the API would 403.
  const ctx = await getTenantContext();
  const canCreate = hasPermission(ctx.orgRole, 'horses:create');
  return <HorsesList canCreate={canCreate} />;
}
