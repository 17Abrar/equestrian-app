import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getBookingSlotById,
  getMemberById,
  validateCoupon,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

// `slotId` is the canonical pricing source — we read amount + currency from
// the slot's lesson type rather than trust client-supplied values. Without
// this, a rider could probe a coupon's behaviour at any amount and binary-
// search the maxDiscount cap. Audit AI-21.
const validateCouponRequestSchema = z
  .object({
    code: z.string().min(1),
    slotId: z.string().uuid(),
    riderMemberId: z.string().uuid(),
    lessonType: z.string().optional(),
  })
  .strict();

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

      const data = await parseRequiredBody(request, validateCouponRequestSchema);

      // Riders/parents may only validate for themselves or the child they
      // booked for. `bookings:read` already covers staff via the wildcard
      // expansion in `hasPermission` — the explicit `bookings:*` check
      // below was dead code (audit F-2) and has been removed.
      const canValidateForOthers = hasPermission(ctx.orgRole, 'bookings:read');

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

      const slot = await getBookingSlotById(ctx.clubId, data.slotId);
      if (!slot) {
        return errorResponse('SLOT_NOT_FOUND', 'Slot not found', 404);
      }

      const result = await validateCoupon({
        clubId: ctx.clubId,
        code: data.code,
        amount: slot.lessonTypePrice,
        currency: slot.lessonTypeCurrency,
        riderMemberId: data.riderMemberId,
        // Prefer the slot's authoritative lesson type over a client-supplied
        // value. Audit H-4: this lets coupon `applicableTypes` enforce on
        // validate-only previews without needing the caller to thread
        // the type through.
        lessonType: slot.lessonTypeType ?? data.lessonType,
      });

      // Audit MED-2 (2026-05-05): tighten the response so the route
      // can't be used as a coupon-code enumeration oracle.
      //   1. Strip `couponId` — booking-create re-resolves the coupon
      //      under FOR UPDATE, so the UI never needs the internal id.
      //   2. Collapse every `valid: false` reason into a single
      //      generic message — the prior path returned distinct
      //      strings for unknown / expired / exhausted, letting an
      //      attacker distinguish "this code exists but is past its
      //      expiry" from "this code never existed". Even with the
      //      10/min failClosed limit, that's a meaningful enumeration
      //      surface for a multi-month brute-force.
      // The server-side log can still distinguish reasons at warn
      // level for ops triage.
      if (!result.valid) {
        return successResponse({
          valid: false,
          discount: 0,
          error: 'Invalid promo code',
        });
      }
      return successResponse({
        valid: true,
        discount: result.discount,
      });
    },
    // failClosed: a Redis outage shouldn't let an attacker brute-force coupon
    // codes by spamming this endpoint. Legit users retry; abuse stays capped.
    // Audit MED-2: tightened from 10/min to 5/min — combined with the unified
    // error message, the brute-force surface is significantly smaller.
    {
      rateLimit: { maxRequests: 5, windowMs: 60_000, failClosed: true },
      routeKey: 'coupons:validate',
    },
  );
}
