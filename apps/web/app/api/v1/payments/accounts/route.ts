import { listPaymentAccounts } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

export async function GET() {
  return withAuth(
    async (ctx) => {
      const accounts = await listPaymentAccounts(ctx.clubId);
      return successResponse(accounts);
    },
    { requiredPermission: 'settings:read' },
  );
}
