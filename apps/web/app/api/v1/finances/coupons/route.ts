import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createCouponSchema, paginationSchema } from '@equestrian/shared/schemas';
import { parseDateTimeLocal } from '@equestrian/shared/utils';
import { getCouponsByClub, createCoupon } from '@equestrian/db/queries';
import { db } from '@equestrian/db';
import { clubs } from '@equestrian/db/schema';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';

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

      const [startsAt, expiresAt] = await Promise.all([
        resolveCouponDate(ctx.clubId, data.startsAt),
        resolveCouponDate(ctx.clubId, data.expiresAt),
      ]);

      const coupon = await createCoupon(ctx.clubId, {
        ...data,
        startsAt,
        expiresAt,
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
