import { type NextRequest } from 'next/server';
import { createCouponSchema } from '@equestrian/shared/schemas';
import { updateCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ couponId: string }>;
}

// `.partial()` to allow updating any subset; `.strict()` to reject any
// key not declared on the base schema. Without strict(), a malicious
// PATCH could rewrite clubId / usageCount / createdByMemberId by
// piggybacking on Drizzle's spread into SET.
const updateCouponSchema = createCouponSchema.partial().strict();

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { couponId } = await params;
      const body = await request.json();
      const data = validateInput(updateCouponSchema, body);

      const coupon = await updateCoupon(ctx.clubId, couponId, {
        ...data,
        // Zod returns ISO strings for `.string().optional()`; Drizzle
        // timestamp columns want Date objects.
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      });

      if (!coupon) {
        return errorResponse('NOT_FOUND', 'Coupon not found', 404);
      }

      void ctx.audit({
        action: 'coupon.update',
        resourceType: 'coupon',
        resourceId: couponId,
      });

      return successResponse(coupon);
    },
    { requiredPermission: 'coupons:update' },
  );
}
