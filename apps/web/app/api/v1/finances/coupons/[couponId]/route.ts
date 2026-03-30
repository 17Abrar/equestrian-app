import { type NextRequest } from 'next/server';
import { updateCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ couponId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { couponId } = await params;
      const body = await request.json();

      const coupon = await updateCoupon(ctx.clubId, couponId, body);

      if (!coupon) {
        return errorResponse('NOT_FOUND', 'Coupon not found', 404);
      }

      return successResponse(coupon);
    },
    { requiredPermission: 'coupons:update' },
  );
}
