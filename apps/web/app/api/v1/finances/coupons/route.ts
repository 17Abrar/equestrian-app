import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { createCouponSchema, paginationSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { getCouponsByClub, createCoupon, getClubTimezone } from '@equestrian/db/queries';
import { couponStatusEnum } from '@equestrian/db/schema';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput, parseRequiredBody } from '@/lib/api-utils';

// Audit G-26: a datetime-local string from the admin form (no Z, no
// offset) is meant to mean "this hour, in the club's local timezone".
// `new Date('2026-12-31T23:59')` parses as server-local (UTC on Workers),
// which means a Dubai admin entering "Dec 31 23:59" stores Dec 31 23:59
// UTC = Jan 1 03:59 Dubai — three hours late. Resolve through
// parseDateTimeLocal when the input lacks timezone info; pass through
// unchanged if the client supplied a Z/offset.
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

async function resolveCouponDate(
  clubId: string,
  value: string | undefined,
): Promise<Date | undefined> {
  if (!value) return undefined;
  if (DATETIME_LOCAL_RE.test(value)) {
    // Audit pass-3 (2026-05-09): soft-delete-gated helper.
    const tz = (await getClubTimezone(clubId)) ?? 'Asia/Dubai';
    return parseDateTimeLocal(value, tz);
  }
  return new Date(value);
}

// Audit F-1 (2026-05-08 r6): the prior literal tuple
// `['active', 'inactive', 'expired']` drifted from the DB pgEnum. `paused`
// was rejected at validation (functional bug — paused coupons unfilterable);
// `inactive` passed validation then fell through to a Postgres
// "invalid input value for enum coupon_status" 500. Bind the filter
// directly to the pgEnum's canonical tuple so the contract is single-
// source-of-truth and any future enum change surfaces here as a TS error.
const couponFiltersSchema = paginationSchema
  .extend({
    status: z.enum(couponStatusEnum.enumValues).optional(),
  })
  .strict();

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
      const data = await parseRequiredBody(request, createCouponSchema);

      const [startsAt, expiresAt] = await Promise.all([
        resolveCouponDate(ctx.clubId, data.startsAt),
        resolveCouponDate(ctx.clubId, data.expiresAt),
      ]);

      // `satisfies` (not `as`) so a future change that adds a string-typed
      // timestamp field to `couponBaseSchema` would surface here as a type
      // error instead of being silently widened through the cast and
      // corrupted by the Date-coerced spread. The earlier `as Parameters<…>`
      // cast hid that risk.
      const coupon = await createCoupon(
        ctx.clubId,
        {
          ...data,
          startsAt,
          expiresAt,
        } satisfies Parameters<typeof createCoupon>[1],
        ctx.memberId ?? undefined,
      );

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
