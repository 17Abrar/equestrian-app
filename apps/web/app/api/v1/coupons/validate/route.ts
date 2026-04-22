import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { validateCoupon } from '@equestrian/db/queries';
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
    { rateLimit: { maxRequests: 10, windowMs: 60_000 } },
  );
}
