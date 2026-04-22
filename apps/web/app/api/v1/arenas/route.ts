import { type NextRequest } from 'next/server';
import { createArenaSchema } from '@equestrian/shared/schemas';
import { getArenasByClub, createArena } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';

export async function GET() {
  return withAuth(
    async (ctx) => {
      const data = await getArenasByClub(ctx.clubId);
      return successResponse(data);
    },
    { requiredPermission: 'arenas:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createArenaSchema, body);

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
