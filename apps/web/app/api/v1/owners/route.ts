import { type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createOwnerSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getOwnersByClub, createMember } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';

// Reuse `paginationSchema` (caps `pageSize` at 100). The previous
// `Number(searchParams.pageSize) || 25` path had no upper bound — a single
// `?pageSize=999999999` request loaded the entire owners table for the club
// into the Worker isolate.
const ownerFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(ownerFiltersSchema, searchParams);

      const { data, total } = await getOwnersByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'owners:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Audit F-63 (2026-05-07 r5).
      const data = await parseRequiredBody(request, createOwnerSchema);

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

      void ctx.audit({
        action: 'owner.create',
        resourceType: 'owner',
        resourceId: member.id,
      });

      return successResponse(member, 201);
    },
    { requiredPermission: 'owners:create' },
  );
}
