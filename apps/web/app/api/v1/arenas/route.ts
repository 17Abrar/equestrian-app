import { type NextRequest } from 'next/server';
import { createArenaSchema } from '@equestrian/shared/schemas';
import { getArenasByClub, createArena } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  paginatedResponse,
  parsePagination,
} from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getArenasByClub(ctx.clubId, { page, pageSize });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'arenas:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Audit F-63 (2026-05-07 r5).
      const data = await parseRequiredBody(request, createArenaSchema);

      const arena = await createArena(ctx.clubId, data);

      if (!arena) {
        return errorResponse('CREATE_FAILED', 'Failed to create arena', 500);
      }

      void ctx.audit({
        action: 'arena.create',
        resourceType: 'arena',
        resourceId: arena.id,
      });

      return successResponse(arena, 201);
    },
    { requiredPermission: 'arenas:create' },
  );
}
