import { type NextRequest } from 'next/server';
import { deleteHealthRecord } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; recordId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, recordId } = await params;
      const result = await deleteHealthRecord(ctx.clubId, horseId, recordId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Health record not found', 404);
      }

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'horses:update' },
  );
}
