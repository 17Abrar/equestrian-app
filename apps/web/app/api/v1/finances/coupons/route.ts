import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { createCouponSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getCouponsByClub, createCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';

const couponFiltersSchema = paginationSchema.extend({
  status: z.enum(['active', 'inactive', 'expired']).optional(),
});

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(couponFiltersSchema, searchParams);

      const { data, total } = await getCouponsByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
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

      void ctx.audit({
        action: 'coupon.create',
        resourceType: 'coupon',
        resourceId: coupon.id,
      });

      return successResponse(coupon, 201);
    },
    { requiredPermission: 'coupons:create' },
  );
}
