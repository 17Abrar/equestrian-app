import { type NextRequest } from 'next/server';
import { updateArenaSchema } from '@equestrian/shared/schemas';
import { getArenaById, updateArena, deleteArena } from '@equestrian/db/queries';
import { withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ arenaId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { arenaId } = await params;
      validateUuidParam('arenaId', arenaId);
      const arena = await getArenaById(ctx.clubId, arenaId);

      if (!arena) {
        return errorResponse('NOT_FOUND', 'Arena not found', 404);
      }

      return successResponse(arena);
    },
    { requiredPermission: 'arenas:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { arenaId } = await params;
      validateUuidParam('arenaId', arenaId);
      const data = await parseRequiredBody(request, updateArenaSchema);

      const arena = await updateArena(ctx.clubId, arenaId, data);

      if (!arena) {
        return errorResponse('NOT_FOUND', 'Arena not found', 404);
      }

      void ctx.audit({
        action: 'arena.update',
        resourceType: 'arena',
        resourceId: arenaId,
      });

      return successResponse(arena);
    },
    { requiredPermission: 'arenas:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { arenaId } = await params;
      validateUuidParam('arenaId', arenaId);
      const arena = await deleteArena(ctx.clubId, arenaId);

      if (!arena) {
        return errorResponse('NOT_FOUND', 'Arena not found', 404);
      }

      void ctx.audit({
        action: 'arena.delete',
        resourceType: 'arena',
        resourceId: arenaId,
      });

      return successResponse(arena);
    },
    { requiredPermission: 'arenas:delete' },
  );
}
