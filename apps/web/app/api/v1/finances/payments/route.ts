import { type NextRequest } from 'next/server';
import { getPaymentsByClub } from '@equestrian/db/queries';
import { withAuth, paginatedResponse } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const page = Number(searchParams.page) || 1;
      const pageSize = Number(searchParams.pageSize) || 25;

      const { data, total } = await getPaymentsByClub(ctx.clubId, {
        status: searchParams.status,
        dateFrom: searchParams.dateFrom,
        dateTo: searchParams.dateTo,
        page,
        pageSize,
      });

      return paginatedResponse(data, { page, pageSize, total });
    },
    { requiredPermission: 'finances:read' },
  );
}
