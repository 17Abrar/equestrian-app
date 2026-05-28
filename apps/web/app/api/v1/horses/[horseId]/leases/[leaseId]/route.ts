import { type NextRequest } from 'next/server';
import { setLeaseStatusSchema } from '@equestrian/shared/schemas';
import {
  getLeaseById,
  setLeaseStatus,
  getHorseById,
  activateLeaseAtomically,
  type LeaseStatus,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  validateUuidParam,
} from '@/lib/api-utils';

/**
 * Lease status transitions:
 *   pending  → active     (admin confirms the lessee is on board)
 *   pending  → cancelled  (admin / lessee aborts before start)
 *   active   → ended      (lease term completed normally)
 *   active   → cancelled  (early termination)
 *   ended    → (terminal — no outgoing transitions)
 *   cancelled → (terminal)
 *
 * Disallowed: active → pending, ended → *, cancelled → *.
 * Mirrors the booking-status transition matrix style.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<LeaseStatus, ReadonlySet<LeaseStatus>>> = {
  pending: new Set(['active', 'cancelled']),
  active: new Set(['ended', 'cancelled']),
  ended: new Set(),
  cancelled: new Set(),
};

interface RouteParams {
  params: Promise<{ horseId: string; leaseId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, leaseId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('leaseId', leaseId);

      const data = await parseRequiredBody(request, setLeaseStatusSchema);

      // Bind horse to caller's tenant — explicit 404 before any
      // lease mutation. The lease's own clubId filter would catch a
      // cross-tenant probe but this surface is friendlier.
      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      const lease = await getLeaseById(ctx.clubId, leaseId);
      if (!lease || lease.horseId !== horseId) {
        return errorResponse('NOT_FOUND', 'Lease not found', 404);
      }

      const allowed = ALLOWED_TRANSITIONS[lease.status as LeaseStatus];
      if (!allowed || !allowed.has(data.status)) {
        return errorResponse(
          'INVALID_TRANSITION',
          `Lease cannot move from ${lease.status} to ${data.status}.`,
          409,
        );
      }

      // Activation path uses the atomic helper — codex P2
      // (2026-05-27). Without the row-level lock on the horse, two
      // concurrent activations could both pass the conflict query
      // before either committed, breaking the full-/half-lease
      // exclusivity invariant.
      let updated: { id: string } | null = null;
      if (data.status === 'active') {
        const result = await activateLeaseAtomically(ctx.clubId, leaseId);
        if (result.result === 'conflict') {
          return errorResponse(
            'LEASE_OVERLAP',
            `An active ${result.conflict.leaseType} lease (${result.conflict.startDate} → ${result.conflict.endDate}) overlaps these dates. Adjust the date range or end the other lease first.`,
            409,
          );
        }
        if (result.result === 'not-found') {
          return errorResponse('NOT_FOUND', 'Lease not found', 404);
        }
        if (result.result === 'not-pending') {
          return errorResponse('STALE_TRANSITION', 'Lease was modified by another request.', 409);
        }
        updated = { id: result.id };
      } else {
        // Non-activation transitions (cancel, end) don't need the
        // overlap check or the horse-row lock — moving OUT of active
        // can only free capacity, never violate the invariant.
        updated = await setLeaseStatus(
          ctx.clubId,
          leaseId,
          data.status,
          lease.status as LeaseStatus,
        );
        if (!updated) {
          return errorResponse('STALE_TRANSITION', 'Lease was modified by another request.', 409);
        }
      }

      void ctx.audit({
        action: 'horse_lease.transition',
        resourceType: 'horse_lease',
        resourceId: leaseId,
        changes: {
          status: { from: lease.status, to: data.status },
        },
      });

      return successResponse(updated);
    },
    { requiredPermission: 'horses:update' },
  );
}
