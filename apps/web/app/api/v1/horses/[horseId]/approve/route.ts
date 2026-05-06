import { type NextRequest } from 'next/server';
import { approveHorseOwnershipSchema } from '@equestrian/shared/schemas';
import {
  approveHorseOwnership,
  getHorseById,
  getClubById,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput, validateUuidParam } from '@/lib/api-utils';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { HorseRegistrationApproved } from '@equestrian/email-templates/horse-registration-approved';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Admin approves a pending horse registration. The mutation flips
 * `ownership_status` from `pending` to `active` and records the livery fee +
 * start date that the billing cron (Round 8.5) will use to schedule invoices.
 *
 * A zero `monthlyLiveryFeeMinor` is legal — the stable is housing the horse
 * off-platform or gratis — and still transitions to `active`. The owner is
 * emailed regardless.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const body = await request.json();
      const data = validateInput(approveHorseOwnershipSchema, body);

      const horse = await approveHorseOwnership(ctx.clubId, horseId, data);

      if (!horse) {
        // The update's WHERE clause filters on `ownership_status = 'pending'`,
        // so a missing row means either: (a) wrong club, (b) already approved
        // or declined, or (c) doesn't exist. 409 covers the common "already
        // reviewed" case; 404 is reserved for truly missing.
        return errorResponse(
          'NOT_PENDING',
          'Horse not found or is not pending approval',
          409,
        );
      }

      void ctx.audit({
        action: 'horse.approve_ownership',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'pending', to: 'active' },
          monthlyLiveryFeeMinor: { from: null, to: data.monthlyLiveryFeeMinor },
          liveryStartDate: { from: null, to: data.liveryStartDate },
        },
      });

      const [fullHorse, club] = await Promise.all([
        getHorseById(ctx.clubId, horseId),
        getClubById(ctx.clubId),
      ]);

      if (fullHorse?.ownerEmail && club) {
        sendTriggeredEmailAsync({
          clubId: ctx.clubId,
          trigger: 'horse_registration_approved',
          to: fullHorse.ownerEmail,
          subject: `${horse.name} has been approved at ${club.name}`,
          template: HorseRegistrationApproved({
            ownerName: fullHorse.ownerName ?? 'there',
            horseName: horse.name,
            clubName: club.name,
            clubCurrency: club.currency,
            monthlyLiveryFeeMinor: data.monthlyLiveryFeeMinor,
            liveryStartDate: data.liveryStartDate,
            portalUrl: 'https://cavaliq.com/rider/horses',
          }),
        });
      }

      return successResponse(horse);
    },
    { requiredPermission: 'horses:update' },
  );
}
