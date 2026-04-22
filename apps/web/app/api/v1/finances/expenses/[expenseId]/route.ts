import { type NextRequest } from 'next/server';
import { updateExpenseSchema } from '@equestrian/shared/schemas';
import { toMinorUnits } from '@equestrian/shared/utils';
import { updateExpense, deleteExpense } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ expenseId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { expenseId } = await params;
      const body = await request.json();
      const data = validateInput(updateExpenseSchema, body);

      const { amount, ...rest } = data;
      const expense = await updateExpense(ctx.clubId, expenseId, {
        ...rest,
        ...(amount !== undefined ? { amount: toMinorUnits(amount) } : {}),
      });

      if (!expense) {
        return errorResponse('NOT_FOUND', 'Expense not found', 404);
      }

      void ctx.audit({
        action: 'expense.update',
        resourceType: 'expense',
        resourceId: expenseId,
      });

      return successResponse(expense);
    },
    { requiredPermission: 'finances:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { expenseId } = await params;
      const result = await deleteExpense(ctx.clubId, expenseId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Expense not found', 404);
      }

      void ctx.audit({
        action: 'expense.delete',
        resourceType: 'expense',
        resourceId: expenseId,
      });

      return successResponse({ id: result.id });
    },
    { requiredPermission: 'finances:delete' },
  );
}
