import { type NextRequest } from 'next/server';
import { updateHorseSchema } from '@equestrian/shared/schemas';
import { getHorseById, updateHorse, softDeleteHorse } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

// `horse_owner` and `rider` hold `horses:*_own` rather than the
// unsuffixed names — the wildcard-or-exact resolver in `hasPermission`
// doesn't fan out the suffix, so a `requiredPermission: 'horses:read'`
// gate would 403 every owner. Mirror the bookings/[bookingId]/route.ts
// shape: load the row first, then enforce `_own` against the horse's
// `ownerMemberId`.

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { horseId } = await params;

    const canReadAny = hasPermission(ctx.orgRole, 'horses:read');
    const canReadOwn = hasPermission(ctx.orgRole, 'horses:read_own');
    if (!canReadAny && !canReadOwn) {
      return errorResponse('FORBIDDEN', 'You do not have permission to view horses', 403);
    }

    const horse = await getHorseById(ctx.clubId, horseId);
    if (!horse) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    if (!canReadAny && horse.ownerMemberId !== ctx.memberId) {
      return errorResponse('FORBIDDEN', 'You can only view your own horses', 403);
    }

    return successResponse(horse);
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { horseId } = await params;
    const body = await request.json();
    const data = validateInput(updateHorseSchema, body);

    const canEditAny = hasPermission(ctx.orgRole, 'horses:update');
    const canEditOwn = hasPermission(ctx.orgRole, 'horses:update_own');
    if (!canEditAny && !canEditOwn) {
      return errorResponse('FORBIDDEN', 'You do not have permission to update horses', 403);
    }

    const existing = await getHorseById(ctx.clubId, horseId);
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    if (!canEditAny && existing.ownerMemberId !== ctx.memberId) {
      return errorResponse('FORBIDDEN', 'You can only update your own horses', 403);
    }

    const horse = await updateHorse(ctx.clubId, horseId, data);
    if (!horse) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    void ctx.audit({
      action: 'horse.update',
      resourceType: 'horse',
      resourceId: horseId,
    });

    return successResponse(horse);
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    const { horseId } = await params;

    const canDeleteAny = hasPermission(ctx.orgRole, 'horses:delete');
    const canDeleteOwn = hasPermission(ctx.orgRole, 'horses:delete_own');
    if (!canDeleteAny && !canDeleteOwn) {
      return errorResponse('FORBIDDEN', 'You do not have permission to delete horses', 403);
    }

    const existing = await getHorseById(ctx.clubId, horseId);
    if (!existing) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    if (!canDeleteAny && existing.ownerMemberId !== ctx.memberId) {
      return errorResponse('FORBIDDEN', 'You can only delete your own horses', 403);
    }

    const deleted = await softDeleteHorse(ctx.clubId, horseId);
    if (!deleted) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    void ctx.audit({
      action: 'horse.archive',
      resourceType: 'horse',
      resourceId: horseId,
    });

    return successResponse({ id: deleted.id, message: 'Horse archived' });
  });
}
