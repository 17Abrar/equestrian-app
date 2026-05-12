import { type NextRequest } from 'next/server';
import { registerHorseOwnershipSchema } from '@equestrian/shared/schemas';
import {
  registerHorseOwnership,
  getClubAdminEmails,
  createAuditEntry,
  getClubById,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { sendTriggeredEmailAsync } from '@/lib/email';
import { logger } from '@/lib/logger';
import { HorseRegistrationSubmitted } from '@equestrian/email-templates/horse-registration-submitted';

/**
 * Rider self-registers ownership of a horse at a stable they belong to.
 *
 * The `clubId` in the request body is the TARGET club (where the horse will
 * be stabled), which may differ from `ctx.clubId` (the user's active
 * tenant) — riders can be members of multiple stables. The permission check
 * in `withAuth` gates entry using the user's role at their active tenant;
 * the query then re-validates membership in the target club.
 *
 * **Audit F-21 (2026-05-08 r6) — TARGET-CLUB pattern.** This is one of
 * the very small set of routes that legitimately accepts `clubId` from
 * the request body (instead of always sourcing it from `ctx.clubId`).
 * The body-clubId rule is broken HERE because a rider/owner may belong
 * to multiple stables and choose where the horse is stabled. The
 * invariant that keeps this safe is the re-check inside
 * `registerHorseOwnership` (`packages/db/src/queries/horses.ts:452-510`)
 * which throws `OWNERSHIP_ROLE_NOT_ALLOWED` unless the caller is an
 * active `club_members` row at `data.clubId` AND has a horse-owning
 * role (`rider` / `horse_owner`) at that club. **Do NOT** remove or
 * weaken that re-check — without it, a coach at club A could register
 * a horse at club B without being a member of B at all.
 */
export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, registerHorseOwnershipSchema);

      let horse;
      try {
        horse = await registerHorseOwnership({
          clubId: data.clubId,
          clerkUserId: ctx.userId,
          name: data.name,
          breed: data.breed,
          gender: data.gender,
          dateOfBirth: data.dateOfBirth,
          color: data.color,
          heightHands: data.heightHands,
          weightKg: data.weightKg,
          skillLevel: data.skillLevel,
          primaryPhotoUrl: data.primaryPhotoUrl,
          notes: data.notes,
        });
      } catch (err) {
        // Audit HIGH-1 (2026-05-05): query throws when the target-club
        // role isn't a horse-owning role (e.g. caller is rider at A,
        // coach at B; passes the active-club gate via A but cannot
        // register horses at B as a coach). 403 with a specific code
        // so the UI can show "ask your stable to set you up as a
        // rider/owner first" rather than "you're not a member".
        if (err instanceof Error && err.message === 'OWNERSHIP_ROLE_NOT_ALLOWED') {
          return errorResponse(
            'OWNERSHIP_ROLE_NOT_ALLOWED',
            'Your role at this stable is not allowed to register horses',
            403,
          );
        }
        throw err;
      }

      if (!horse) {
        // The query returns null when the user isn't an active member of the
        // target club. 403 rather than 404 to make the auth failure explicit.
        return errorResponse('NOT_A_MEMBER', 'You are not a member of this stable', 403);
      }

      // Audit on the TARGET club, not ctx.clubId (they may differ). Calling
      // createAuditEntry directly because ctx.audit() closes over ctx.clubId.
      // The submitter's membership in the target club IS horse.ownerMemberId —
      // that's the right value for `actorMemberId` on this audit row.
      void createAuditEntry({
        clubId: horse.clubId,
        actorMemberId: horse.ownerMemberId,
        action: 'horse.register_ownership',
        resourceType: 'horse',
        resourceId: horse.id,
        changes: {
          name: { from: null, to: horse.name },
          ownershipStatus: { from: null, to: 'pending' },
        },
      }).catch((err) => {
        logger.error('audit_log_failed', {
          clubId: horse.clubId,
          action: 'horse.register_ownership',
          resourceId: horse.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Notify admins of the target club so they can review.
      const [club, admins] = await Promise.all([
        getClubById(horse.clubId),
        getClubAdminEmails(horse.clubId),
      ]);

      if (club) {
        for (const admin of admins) {
          sendTriggeredEmailAsync({
            clubId: horse.clubId,
            trigger: 'horse_registration_submitted',
            to: admin.email,
            subject: `New horse registration at ${club.name}`,
            template: HorseRegistrationSubmitted({
              adminName: admin.displayName ?? 'there',
              horseName: horse.name,
              horseBreed: horse.breed ?? undefined,
              ownerName: horse.ownerDisplayName ?? horse.ownerEmail ?? 'A rider',
              clubName: club.name,
              reviewUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'}/horses?ownershipStatus=pending`,
            }),
          });
        }
      }

      return successResponse(horse, 201);
    },
    {
      requiredPermission: 'horses:register_own',
      // Audit QA-22 — admins must review every pending registration.
      // Cap at 5/hour per rider so a runaway form can't backlog the
      // admin queue with hundreds of pending rows.
      // failClosed (audit LOW 2026-05-06) — Upstash outage must NOT
      // lift the cap; the abuse-bounded routes elsewhere
      // (`coupons/validate`, `discover/clubs`, `clubs/[slug]/join`)
      // already use this posture.
      rateLimit: { maxRequests: 5, windowMs: 3_600_000, failClosed: true },
      routeKey: 'register_ownership',
    },
  );
}
