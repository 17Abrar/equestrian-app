import { type NextRequest } from 'next/server';
import { updateHorseSchema } from '@equestrian/shared/schemas';
import { getHorseById, updateHorse, softDeleteHorse } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const horse = await getHorseById(ctx.clubId, horseId);

      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      return successResponse(horse);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(updateHorseSchema, body);

      const horse = await updateHorse(ctx.clubId, horseId, data);

      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      return successResponse(horse);
    },
    { requiredPermission: 'horses:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const deleted = await softDeleteHorse(ctx.clubId, horseId);

      if (!deleted) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      return successResponse({ id: deleted.id, message: 'Horse archived' });
    },
    { requiredPermission: 'horses:delete' },
  );
}
