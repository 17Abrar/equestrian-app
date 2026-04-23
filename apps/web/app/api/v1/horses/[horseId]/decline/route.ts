import { type NextRequest } from 'next/server';
import { declineHorseOwnershipSchema } from '@equestrian/shared/schemas';
import {
  declineHorseOwnership,
  getHorseById,
  getClubById,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { HorseRegistrationDeclined } from '@equestrian/email-templates/horse-registration-declined';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Admin declines a pending horse registration. The row is kept (not soft
 * deleted) so the rider can see the decline reason in their "My Horses" tab
 * — an opaque disappearance would be worse UX.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(declineHorseOwnershipSchema, body);

      const horse = await declineHorseOwnership(ctx.clubId, horseId, data.reason);

      if (!horse) {
        return errorResponse(
          'NOT_PENDING',
          'Horse not found or is not pending approval',
          409,
        );
      }

      void ctx.audit({
        action: 'horse.decline_ownership',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'pending', to: 'declined' },
          reason: { from: null, to: data.reason },
        },
      });

      const [fullHorse, club] = await Promise.all([
        getHorseById(ctx.clubId, horseId),
        getClubById(ctx.clubId),
      ]);

      if (fullHorse?.ownerEmail && club) {
        sendTriggeredEmailAsync({
          clubId: ctx.clubId,
          trigger: 'horse_registration_declined',
          to: fullHorse.ownerEmail,
          subject: `Update on ${horse.name}'s registration at ${club.name}`,
          template: HorseRegistrationDeclined({
            ownerName: fullHorse.ownerName ?? 'there',
            horseName: horse.name,
            clubName: club.name,
            reason: data.reason,
          }),
        });
      }

      return successResponse(horse);
    },
    { requiredPermission: 'horses:update' },
  );
}
