import { type NextRequest } from 'next/server';
import { getLiveryInvoicesByHorse } from '@equestrian/db/queries';
import { withAuth, successResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Lists livery invoices for a horse. Admin-only — owners see their own
 * invoices via `/api/v1/me/livery-invoices` (below).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const invoices = await getLiveryInvoicesByHorse(ctx.clubId, horseId);
      return successResponse(invoices);
    },
    { requiredPermission: 'horses:read' },
  );
}
