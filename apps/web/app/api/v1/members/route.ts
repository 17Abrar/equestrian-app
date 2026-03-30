import { type NextRequest } from 'next/server';
import { getMembersByRole } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const role = request.nextUrl.searchParams.get('role');
      const roles = role ? [role] : [];

      const members = await getMembersByRole(ctx.clubId, roles);

      return successResponse(members);
    },
    { requiredPermission: 'riders:read' },
  );
}
