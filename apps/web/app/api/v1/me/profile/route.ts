import { getRiderByMemberId } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

export async function GET() {
  return withAuth(async (ctx) => {
    if (!ctx.memberId) {
      return errorResponse('NO_MEMBER', 'Member profile not found', 404);
    }

    const rider = await getRiderByMemberId(ctx.clubId, ctx.memberId);
    return successResponse(rider);
  });
}
