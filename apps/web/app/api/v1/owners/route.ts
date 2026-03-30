import { type NextRequest } from 'next/server';
import { createOwnerSchema } from '@equestrian/shared/schemas';
import { getOwnersByClub, createMember } from '@equestrian/db/queries';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const page = Number(searchParams.page) || 1;
      const pageSize = Number(searchParams.pageSize) || 25;
      const search = searchParams.search;

      const { data, total } = await getOwnersByClub(ctx.clubId, { search, page, pageSize });

      return paginatedResponse(data, { page, pageSize, total });
    },
    { requiredPermission: 'owners:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createOwnerSchema, body);

      const member = await createMember(ctx.clubId, {
        clerkUserId: `manual_${randomUUID()}`,
        role: 'horse_owner',
        displayName: data.displayName,
        email: data.email,
        phone: data.phone,
      });

      if (!member) {
        return errorResponse('CREATE_FAILED', 'Failed to create owner', 500);
      }

      logger.info('owner_created', {
        memberId: member.id,
        clubId: ctx.clubId,
      });

      return successResponse(member, 201);
    },
    { requiredPermission: 'owners:create' },
  );
}
