import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getMemberById, validateCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

const validateCouponRequestSchema = z.object({
  code: z.string().min(1),
  amount: z.number().int().min(0),
  riderMemberId: z.string().uuid(),
  lessonType: z.string().optional(),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Anyone with booking-creation rights may validate a promo code.
      // Covers riders (bookings:create), parents (bookings:create_child),
      // and staff via the `bookings:*` wildcard.
      const canValidate =
        hasPermission(ctx.orgRole, 'bookings:create') ||
        hasPermission(ctx.orgRole, 'bookings:create_child');

      if (!canValidate) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to validate coupons',
          403,
        );
      }

      const body = await request.json();
      const data = validateInput(validateCouponRequestSchema, body);

      // Riders/parents may only validate for themselves or the child they booked for.
      const canValidateForOthers =
        hasPermission(ctx.orgRole, 'bookings:read') ||
        hasPermission(ctx.orgRole, 'bookings:*');

      if (!canValidateForOthers) {
        if (!ctx.memberId) {
          return errorResponse('NO_MEMBER', 'Member profile not found', 403);
        }
        if (data.riderMemberId !== ctx.memberId) {
          return errorResponse(
            'FORBIDDEN',
            'You can only validate coupons for yourself',
            403,
          );
        }
      } else {
        // Staff path: confirm the rider actually belongs to this club. The
        // route would otherwise count per-rider coupon usage against an
        // arbitrary UUID, which doesn't leak data today (couponId is
        // already club-scoped) but would under any future cross-club
        // coupon link.
        const rider = await getMemberById(ctx.clubId, data.riderMemberId);
        if (!rider) {
          return errorResponse(
            'INVALID_RIDER',
            'Rider is not a member of this club',
            400,
          );
        }
      }

      const result = await validateCoupon({
        clubId: ctx.clubId,
        code: data.code,
        amount: data.amount,
        riderMemberId: data.riderMemberId,
        lessonType: data.lessonType,
      });

      return successResponse(result);
    },
    // failClosed: a Redis outage shouldn't let an attacker brute-force coupon
    // codes by spamming this endpoint. Legit users retry; abuse stays capped.
    { rateLimit: { maxRequests: 10, windowMs: 60_000, failClosed: true } },
  );
}
