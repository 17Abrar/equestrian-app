import { withAuth, successResponse } from '@/lib/api-utils';

export async function GET() {
  return withAuth(async (ctx) => {
    return successResponse({
      userId: ctx.userId,
      memberId: ctx.memberId,
      orgId: ctx.orgId,
      role: ctx.orgRole,
    });
  });
}
