import { type NextRequest } from 'next/server';
import { updateExpenseSchema } from '@equestrian/shared/schemas';
import { toMinorUnits } from '@equestrian/shared/utils';
import { getExpenseById, updateExpense, deleteExpense } from '@equestrian/db/queries';
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

      // Need the row's currency to scale the new amount correctly when the
      // PATCH only changes amount (no `currency` in the body) — KWD/BHD/JOD
      // etc. are 3-decimal so scaling the wrong way silently 10×s the value.
      const existing = await getExpenseById(ctx.clubId, expenseId);
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Expense not found', 404);
      }

      // Currency change without a fresh amount is ambiguous: do we re-scale
      // the existing minor units (10000 minor in AED 2-decimal != 10000
      // minor in KWD 3-decimal — that's 100 AED vs 10 KWD), or treat the
      // row as intentionally re-priced? Reject it and force the caller to
      // either change currency+amount together or leave currency alone.
      // Audit AI-21.
      if (data.currency && data.currency !== existing.currency && amount === undefined) {
        return errorResponse(
          'CURRENCY_CHANGE_REQUIRES_AMOUNT',
          'Changing currency requires re-stating the amount in the new currency.',
          422,
        );
      }

      let amountMinor: number | undefined;
      if (amount !== undefined) {
        const targetCurrency = data.currency ?? existing.currency;
        amountMinor = toMinorUnits(amount, targetCurrency);
      }

      const expense = await updateExpense(ctx.clubId, expenseId, {
        ...rest,
        ...(amountMinor !== undefined ? { amount: amountMinor } : {}),
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
