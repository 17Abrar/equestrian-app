import { type NextRequest } from 'next/server';
import { getInvoicesByClub } from '@equestrian/db/queries';
import { withAuth, paginatedResponse } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const page = Number(searchParams.page) || 1;
      const pageSize = Number(searchParams.pageSize) || 25;

      const { data, total } = await getInvoicesByClub(ctx.clubId, {
        status: searchParams.status,
        page,
        pageSize,
      });

      return paginatedResponse(data, { page, pageSize, total });
    },
    { requiredPermission: 'finances:read' },
  );
}
