import { type NextRequest } from 'next/server';
import { horseFiltersSchema, createHorseSchema } from '@equestrian/shared/schemas';
import { getHorsesByClub, createHorse, getMemberById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
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
      // Audit F-15 (2026-05-06 r2): use `parseRequiredBody` (which
      // enforces the route-level body cap + JSON-parse error handling)
      // instead of inlining `request.json()` + `validateInput`. Mirrors
      // the pattern used by every other v1 mutation route.
      const data = await parseRequiredBody(request, createHorseSchema);

      // The owner dropdown is populated from the club's owner list, but a
      // caller hitting the API directly could pass any UUID. Verify the
      // owner belongs to this club AND has a role that's actually allowed
      // to own a horse — coaches/grooms/managers passed here would surface
      // as the horse's owner in /me/horses (audit A-5).
      if (data.ownerMemberId) {
        const owner = await getMemberById(ctx.clubId, data.ownerMemberId);
        if (!owner) {
          return errorResponse('INVALID_OWNER', 'Owner is not a member of this club', 400);
        }
        if (owner.role !== 'horse_owner' && owner.role !== 'rider') {
          return errorResponse(
            'INVALID_OWNER_ROLE',
            'Horse owner must have role horse_owner or rider',
            400,
          );
        }
      }

      const horse = await createHorse(ctx.clubId, data);

      if (!horse) {
        return errorResponse('CREATE_FAILED', 'Failed to create horse', 500);
      }

      void ctx.audit({
        action: 'horse.create',
        resourceType: 'horse',
        resourceId: horse.id,
      });

      return successResponse(horse, 201);
    },
    { requiredPermission: 'horses:create' },
  );
}
