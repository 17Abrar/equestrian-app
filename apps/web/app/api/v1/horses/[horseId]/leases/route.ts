import { type NextRequest } from 'next/server';
import { createHorseLeaseSchema } from '@equestrian/shared/schemas';
import {
  listLeasesForHorse,
  createLease,
  getHorseById,
  getMemberById,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

/**
 * Horse leases under a specific horse. Tenant-scoped both ways:
 * the horse and the lessee member must both belong to the calling
 * club. The composite FKs in migration 0064 enforce this at the DB
 * layer too, but the explicit lookup gives a friendlier 404/422 than
 * a raw FK violation.
 *
 * Permissions: piggyback on horses-management
 *   - GET requires `horses:read` (anyone who can view horses)
 *   - POST requires `horses:update` (admins/managers — leasing is a
 *     club-side commercial arrangement, not a rider self-service flow)
 */
interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      // Bind horse to caller's tenant before listing — a member of
      // Club B with horses:read could otherwise GET against a Club A
      // horseId. The query already scopes by clubId; this is the
      // explicit 404 path so we don't 200-empty on cross-tenant probes.
      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }
      const items = await listLeasesForHorse(ctx.clubId, horseId);
      return successResponse(items);
    },
    // Codex P2 (2026-05-27): require `horses:update` not
    // `horses:read`. The list projection includes lessee email +
    // monthly fee + free-text notes — financial / PII data that
    // coach/groom/vet roles should not see. Admins and managers
    // (who already create/transition leases) have horses:update.
    // Lessee-side visibility for their own lease is queued for the
    // rider-portal PR (#3 of 3 in this feature).
    { requiredPermission: 'horses:update' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);

      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      const data = await parseRequiredBody(request, createHorseLeaseSchema);

      // Resolve the lessee member to this tenant before insert. The
      // composite FK would reject an out-of-club row, but the explicit
      // lookup returns a friendlier 422 than a 500 with an FK error
      // payload.
      const lessee = await getMemberById(ctx.clubId, data.lesseeMemberId);
      if (!lessee) {
        return errorResponse('LESSEE_NOT_FOUND', 'Lessee is not a member of this club.', 422);
      }

      // Codex P2 (2026-05-27): the lessee must be a rider or horse_owner.
      // Persisting a lease against a coach/groom/admin row would leak
      // into downstream lease lists + billing surfaces as a
      // valid-looking record against the wrong person. We don't allow
      // `parent` — a parent's child rider should be the lessee directly.
      const LESSEE_ROLES = new Set(['rider', 'horse_owner']);
      if (!LESSEE_ROLES.has(lessee.role)) {
        return errorResponse(
          'LESSEE_ROLE_NOT_ALLOWED',
          'Only members with the rider or horse_owner role can be lessees.',
          422,
        );
      }

      const lease = await createLease(ctx.clubId, {
        horseId,
        lesseeMemberId: data.lesseeMemberId,
        leaseType: data.leaseType,
        monthlyFeeMinor: data.monthlyFeeMinor,
        currency: data.currency,
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes ?? null,
      });
      if (!lease) {
        return errorResponse('CREATE_FAILED', 'Failed to create lease', 500);
      }

      void ctx.audit({
        action: 'horse_lease.create',
        resourceType: 'horse_lease',
        resourceId: lease.id,
        changes: {
          horseId: { from: null, to: horseId },
          lesseeMemberId: { from: null, to: data.lesseeMemberId },
          leaseType: { from: null, to: data.leaseType },
          monthlyFeeMinor: { from: null, to: data.monthlyFeeMinor },
          currency: { from: null, to: data.currency },
          startDate: { from: null, to: data.startDate },
          endDate: { from: null, to: data.endDate },
          status: { from: null, to: 'pending' },
        },
      });

      return successResponse(lease, 201);
    },
    { requiredPermission: 'horses:update' },
  );
}
