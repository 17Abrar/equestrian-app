import { type NextRequest } from 'next/server';
import { createExpenseSchema, expenseFiltersSchema } from '@equestrian/shared/schemas';
import { getExpensesByClub, createExpense } from '@equestrian/db/queries';
import { toMinorUnits } from '@equestrian/shared/utils';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = expenseFiltersSchema.parse(searchParams);
      const { data, total } = await getExpensesByClub(ctx.clubId, filters);
      return paginatedResponse(data, { page: filters.page, pageSize: filters.pageSize, total });
    },
    { requiredPermission: 'finances:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createExpenseSchema, body);

      const expense = await createExpense(ctx.clubId, {
        ...data,
        amount: toMinorUnits(data.amount),
      }, ctx.memberId ?? undefined);

      if (!expense) {
        return errorResponse('CREATE_FAILED', 'Failed to create expense', 500);
      }

      void ctx.audit({
        action: 'expense.create',
        resourceType: 'expense',
        resourceId: expense.id,
      });

      return successResponse(expense, 201);
    },
    { requiredPermission: 'finances:create' },
  );
}
