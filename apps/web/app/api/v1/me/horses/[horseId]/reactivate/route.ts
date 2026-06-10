import { type NextRequest } from 'next/server';
import {
  reactivateRetiredOwnership,
  getHorseOwnershipByUser,
  getMemberByClerkUserAndClub,
  getClubAdminEmails,
  getClubById,
  getHorseById,
  createAuditEntry,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions-shared';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { HorseRegistrationSubmitted } from '@equestrian/email-templates/horse-registration-submitted';
import { logger } from '@/lib/logger';
import { type UserRole } from '@equestrian/shared/types';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

/**
 * Owner-initiated reactivation of a retired horse. Audit P1
 * (2026-05-26): the previous flow required the rider to DM the
 * stable. This route lets the owner re-submit the horse for
 * admin re-approval — flips ownership `retired` → `pending` and
 * clears the prior `liveryEndDate`. The admin re-approves with a
 * fresh livery fee through the existing approval surface.
 *
 * Auth mirrors the retire endpoint: ownership is verified via
 * Clerk user ID first (the owner's active tenant may not be the
 * horse's club), then we pass the horse's own clubId into the
 * mutation.
 */
export async function PATCH(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);

      const ownership = await getHorseOwnershipByUser(ctx.userId, horseId);
      if (!ownership) {
        return errorResponse('FORBIDDEN', 'You are not the owner of this horse', 403);
      }

      // Permission check against the TARGET club (the horse's club),
      // not the active tenant. A multi-club owner whose active club
      // role lacks `horses:update_own` (e.g., active as parent at
      // club A, rider at club B) was previously 403'd by withAuth's
      // active-tenant requirement — codex P2 (2026-05-26).
      const targetMembership = await getMemberByClerkUserAndClub(ctx.userId, ownership.clubId);
      if (!targetMembership || !targetMembership.isActive) {
        return errorResponse('FORBIDDEN', 'You are not an active member of this horse’s club', 403);
      }
      if (!hasPermission(targetMembership.role as UserRole, 'horses:update_own')) {
        return errorResponse(
          'FORBIDDEN',
          'Your role at this club cannot reactivate horse ownership.',
          403,
        );
      }

      if (ownership.ownershipStatus !== 'retired') {
        return errorResponse('NOT_RETIRED', 'Only retired horses can be reactivated.', 409);
      }

      const updated = await reactivateRetiredOwnership(
        ownership.clubId,
        horseId,
        ownership.ownerMemberId,
      );
      if (!updated) {
        // Race: admin / another flow advanced the row between the read
        // and the update. The status precondition isn't met anymore.
        return errorResponse('NOT_RETIRED', 'Unable to reactivate horse', 409);
      }

      const actor =
        ctx.clubId === ownership.clubId
          ? { id: ctx.memberId }
          : await getMemberByClerkUserAndClub(ctx.userId, ownership.clubId);

      void createAuditEntry({
        clubId: ownership.clubId,
        actorMemberId: actor?.id ?? null,
        action: 'horse.reactivate_ownership_self',
        resourceType: 'horse',
        resourceId: horseId,
        changes: {
          ownershipStatus: { from: 'retired', to: 'pending' },
        },
      }).catch((err) => {
        logger.error('audit_log_failed', {
          clubId: ownership.clubId,
          action: 'horse.reactivate_ownership_self',
          resourceId: horseId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Codex P2 (2026-05-26): notify the target club's admins —
      // mirrors the original registration flow so the admin team sees
      // the pending-review surface without depending on the in-app
      // badge alone. The rider dialog promises this notification.
      const [club, admins, horseRow] = await Promise.all([
        getClubById(ownership.clubId),
        getClubAdminEmails(ownership.clubId),
        getHorseById(ownership.clubId, horseId),
      ]);

      if (club && horseRow) {
        // `getHorseById` projects `ownerEmail` but not display name —
        // fallback chain mirrors the registration email exactly so a
        // never-named owner reads as "A rider" rather than blank.
        const ownerName = horseRow.ownerEmail ?? 'A rider';
        for (const admin of admins) {
          sendTriggeredEmailAsync({
            clubId: ownership.clubId,
            trigger: 'horse_registration_submitted',
            to: admin.email,
            subject: `Horse re-registration at ${club.name}`,
            template: HorseRegistrationSubmitted({
              adminName: admin.displayName ?? 'there',
              horseName: horseRow.name,
              horseBreed: horseRow.breed ?? undefined,
              ownerName,
              clubName: club.name,
              reviewUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/horses?ownershipStatus=pending`,
            }),
          });
        }
      }

      return successResponse(updated);
    },
    // No active-tenant `requiredPermission` — the target-club check
    // above is the authoritative gate. Codex P2 (2026-05-26) flagged
    // that the active-tenant gate creates false 403s for multi-club
    // owners. The retire endpoint still uses the active-tenant
    // gate (queued as a sweep follow-up in tasks #23) — both
    // patterns coexist for now.
  );
}
