import { getDashboardStats } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

export async function GET() {
  return withAuth(
    async (ctx) => {
      const stats = await getDashboardStats(ctx.clubId);
      return successResponse(stats);
    },
    { requiredPermission: 'dashboard:read' },
  );
}
