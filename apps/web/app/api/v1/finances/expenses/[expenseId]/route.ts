import { type NextRequest } from 'next/server';
import { deleteExpense } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ expenseId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { expenseId } = await params;
      const result = await deleteExpense(ctx.clubId, expenseId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Expense not found', 404);
      }

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'finances:delete' },
  );
}
