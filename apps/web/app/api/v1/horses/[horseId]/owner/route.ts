import { type NextRequest } from 'next/server';
import { transferHorseOwnerSchema } from '@equestrian/shared/schemas';
import { getHorseById, getMemberById, updateHorse } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Reassigns (or clears) a horse's owner. This is deliberately a separate
 * endpoint from PATCH /horses/[id] so the update schema can't smuggle an
 * `ownerMemberId` field in alongside weight/gear changes — see audit
 * finding on `updateHorseSchema` mass assignment.
 *
 * Pass `{ ownerMemberId: null }` to mark the horse as a school horse
 * (no owner). A non-null value must be a member of the current club.
 *
 * Note this endpoint is for admin-driven reassignments only. Rider-
 * initiated ownership flows (register / retire) live elsewhere and use
 * the `ownershipStatus` state machine.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const data = await parseRequiredBody(request, transferHorseOwnerSchema);

      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      // No-op — return current state without writing or audit-logging.
      if (horse.ownerMemberId === data.ownerMemberId) {
        return successResponse(horse);
      }

      if (data.ownerMemberId !== null) {
        const owner = await getMemberById(ctx.clubId, data.ownerMemberId);
        if (!owner) {
          return errorResponse(
            'INVALID_OWNER',
            'Owner is not a member of this club',
            400,
          );
        }
        // Mirror the role check on POST /horses (audit A-5) — only
        // horse_owners and riders are valid owners. Coach/groom assignment
        // would surface in /me/horses as if they owned the horse.
        if (owner.role !== 'horse_owner' && owner.role !== 'rider') {
          return errorResponse(
            'INVALID_OWNER_ROLE',
            'Horse owner must have role horse_owner or rider',
            400,
          );
        }
      }

      const updated = await updateHorse(ctx.clubId, horseId, {
        ownerMemberId: data.ownerMemberId,
      });

      if (!updated) {
        return errorResponse('UPDATE_FAILED', 'Failed to transfer ownership', 500);
      }

      void ctx.audit({
        action: 'horse.transfer_ownership',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownerMemberId: {
            from: horse.ownerMemberId,
            to: data.ownerMemberId,
          },
        },
      });

      return successResponse(updated);
    },
    { requiredPermission: 'horses:update' },
  );
}
