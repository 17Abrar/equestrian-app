import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listPublicClubs } from '@equestrian/db/queries';

// Public endpoint — no auth required. Allows sign-out riders to browse clubs
// before committing to a sign-up.

const queryShape = z.object({
  search: z.string().optional(),
  city: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: NextRequest) {
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = queryShape.safeParse(sp);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { data, total } = await listPublicClubs(parsed.data);
  const { page, pageSize } = parsed.data;

  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
