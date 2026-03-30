import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { validateCoupon } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

const validateCouponRequestSchema = z.object({
  code: z.string().min(1),
  amount: z.number().int().min(0),
  riderMemberId: z.string().uuid(),
  lessonType: z.string().optional(),
});

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(validateCouponRequestSchema, body);

      const result = await validateCoupon({
        clubId: ctx.clubId,
        code: data.code,
        amount: data.amount,
        riderMemberId: data.riderMemberId,
        lessonType: data.lessonType,
      });

      return successResponse(result);
    },
  );
}
