import { type NextRequest } from 'next/server';
import { deleteDocument } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; documentId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, documentId } = await params;
      const result = await deleteDocument(ctx.clubId, horseId, documentId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Document not found', 404);
      }

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'horses:update' },
  );
}
