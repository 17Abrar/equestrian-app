import { type NextRequest } from 'next/server';
import { createExpenseSchema, expenseFiltersSchema } from '@equestrian/shared/schemas';
import { getExpensesByClub, createExpense, getHorseById } from '@equestrian/db/queries';
import { toMinorUnits } from '@equestrian/shared/utils';
import { withAuth, successResponse, paginatedResponse, errorResponse, validateInput, parseRequiredBody } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(expenseFiltersSchema, searchParams);
      const { data, total } = await getExpensesByClub(ctx.clubId, filters);
      return paginatedResponse(data, { page: filters.page, pageSize: filters.pageSize, total });
    },
    { requiredPermission: 'finances:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, createExpenseSchema);

      // Audit LOW (2026-05-05 pass 2): cross-tenant verify the optional
      // horseId. The `expenses.horse_id` column has no composite FK
      // (audit trail target only — horse-deletion shouldn't lose the
      // expense row), so a forged UUID from another club would
      // otherwise insert cleanly and skew per-horse cost reports.
      if (data.horseId) {
        const horse = await getHorseById(ctx.clubId, data.horseId);
        if (!horse) {
          return errorResponse(
            'INVALID_HORSE',
            'Horse not found in this club',
            400,
          );
        }
      }

      // Convert at the user-entered currency, not a hardcoded 2-decimal scale
      // — KWD/BHD/JOD/OMR/TND are 3-decimal, JPY/KRW/etc. are 0-decimal.
      const expense = await createExpense(ctx.clubId, {
        ...data,
        amount: toMinorUnits(data.amount, data.currency),
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
