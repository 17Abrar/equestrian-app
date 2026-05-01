import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { couponBaseSchema, couponPercentageRefine } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { updateCoupon } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// Same timezone-resolve flow as the create route — see audit G-26.
async function resolveCouponDate(
  clubId: string,
  value: string | undefined,
): Promise<Date | undefined> {
  if (!value) return undefined;
  if (DATETIME_LOCAL_RE.test(value)) {
    const club = await db
      .select({ timezone: clubs.timezone })
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);
    const tz = club[0]?.timezone ?? 'Asia/Dubai';
    return parseDateTimeLocal(value, tz);
  }
  return new Date(value);
}

interface RouteParams {
  params: Promise<{ couponId: string }>;
}

// `.partial()` to allow updating any subset; `.strict()` to reject any
// key not declared on the base schema. Without strict(), a malicious
// PATCH could rewrite clubId / usageCount / createdByMemberId by
// piggybacking on Drizzle's spread into SET. The percentage refine is
// re-applied so a partial update from {discountType:'percentage'} →
// discountValue:250 still 422s. Audit AI-21.
const updateCouponSchema = couponBaseSchema
  .partial()
  .superRefine(couponPercentageRefine);

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { couponId } = await params;
      const body = await request.json();
      const data = validateInput(updateCouponSchema, body);

      const [startsAt, expiresAt] = await Promise.all([
        resolveCouponDate(ctx.clubId, data.startsAt),
        resolveCouponDate(ctx.clubId, data.expiresAt),
      ]);

      const coupon = await updateCoupon(ctx.clubId, couponId, {
        ...data,
        startsAt,
        expiresAt,
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
