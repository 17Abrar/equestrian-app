import { type NextRequest } from 'next/server';
import { createCouponSchema } from '@equestrian/shared/schemas';
import { getCouponsByClub, createCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const page = Number(searchParams.page) || 1;
      const pageSize = Number(searchParams.pageSize) || 25;

      const { data, total } = await getCouponsByClub(ctx.clubId, {
        status: searchParams.status,
        page,
        pageSize,
      });

      return paginatedResponse(data, { page, pageSize, total });
    },
    { requiredPermission: 'coupons:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createCouponSchema, body);

      const coupon = await createCoupon(ctx.clubId, {
        ...data,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      } as Parameters<typeof createCoupon>[1], ctx.memberId ?? undefined);

      if (!coupon) {
        return errorResponse('CREATE_FAILED', 'Failed to create coupon', 500);
      }

      return successResponse(coupon, 201);
    },
    { requiredPermission: 'coupons:create' },
  );
}
