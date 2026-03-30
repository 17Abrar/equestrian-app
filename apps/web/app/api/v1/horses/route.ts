import { type NextRequest } from 'next/server';
import { horseFiltersSchema, createHorseSchema } from '@equestrian/shared/schemas';
import { getHorsesByClub, createHorse } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(horseFiltersSchema, searchParams);

      const { data, total } = await getHorsesByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createHorseSchema, body);

      const horse = await createHorse(ctx.clubId, data);

      if (!horse) {
        return errorResponse('CREATE_FAILED', 'Failed to create horse', 500);
      }

      return successResponse(horse, 201);
    },
    { requiredPermission: 'horses:create' },
  );
}
