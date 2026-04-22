import { type NextRequest } from 'next/server';
import { createStaffSchema, staffFiltersSchema } from '@equestrian/shared/schemas';
import { getStaffByClub, createMember } from '@equestrian/db/queries';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = staffFiltersSchema.parse(searchParams);

      const { data, total } = await getStaffByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'staff:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createStaffSchema, body);

      const member = await createMember(ctx.clubId, {
        clerkUserId: `manual_${randomUUID()}`,
        role: data.role,
        displayName: data.displayName,
        email: data.email,
        phone: data.phone,
      });

      if (!member) {
        return errorResponse('CREATE_FAILED', 'Failed to create staff member', 500);
      }

      logger.info('staff_created', {
        memberId: member.id,
        clubId: ctx.clubId,
        role: data.role,
      });

      void ctx.audit({
        action: 'staff.create',
        resourceType: 'staff',
        resourceId: member.id,
        changes: {
          role: { from: null, to: data.role },
        },
      });

      return successResponse(member, 201);
    },
    { requiredPermission: 'staff:create' },
  );
}
