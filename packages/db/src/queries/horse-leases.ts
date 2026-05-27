import { eq, and, desc, sql, ne, or } from 'drizzle-orm';
import { db, writeTransaction } from '../index';
import { horseLeases } from '../schema/horse-leases';
import { horses } from '../schema/horses';
import { type leaseTypeEnum, type leaseStatusEnum } from '../schema/enums';
import { clubMembers } from '../schema/club-members';

/**
 * Horse leasing queries. Every helper takes `clubId` first and
 * filters `eq(horseLeases.clubId, clubId)` in the WHERE clause —
 * the multi-tenant scoping the rest of the codebase enforces.
 *
 * Composite FKs at the DB layer (migration 0064) make a cross-tenant
 * row impossible to insert anyway, but the helpers belt-and-braces
 * the application gate.
 */

export type LeaseType = (typeof leaseTypeEnum.enumValues)[number];
export type LeaseStatus = (typeof leaseStatusEnum.enumValues)[number];

export interface CreateLeaseInput {
  horseId: string;
  lesseeMemberId: string;
  leaseType: LeaseType;
  monthlyFeeMinor: number;
  currency: string;
  startDate: string;
  endDate: string;
  notes: string | null;
}

/**
 * Returns the active lease for a horse (if any) for the
 * "Currently leased to X" surface on the horse profile. A horse can
 * in principle have multiple half-leases; this returns the
 * most-recently created active one. Listing every active lease for
 * the same horse is what `listLeasesForHorse` is for.
 */
export async function getActiveLeaseForHorse(clubId: string, horseId: string) {
  const rows = await db
    .select({
      id: horseLeases.id,
      leaseType: horseLeases.leaseType,
      lesseeMemberId: horseLeases.lesseeMemberId,
      lesseeName: clubMembers.displayName,
      lesseeEmail: clubMembers.email,
      monthlyFeeMinor: horseLeases.monthlyFeeMinor,
      currency: horseLeases.currency,
      startDate: horseLeases.startDate,
      endDate: horseLeases.endDate,
      status: horseLeases.status,
      notes: horseLeases.notes,
      createdAt: horseLeases.createdAt,
    })
    .from(horseLeases)
    .innerJoin(
      clubMembers,
      and(eq(horseLeases.lesseeMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .where(
      and(
        eq(horseLeases.clubId, clubId),
        eq(horseLeases.horseId, horseId),
        eq(horseLeases.status, 'active'),
      ),
    )
    .orderBy(desc(horseLeases.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Full history of leases for a horse — used by the admin horse-
 * profile lease tab. Newest first. Always tenant-scoped via clubId.
 */
export async function listLeasesForHorse(clubId: string, horseId: string) {
  return db
    .select({
      id: horseLeases.id,
      leaseType: horseLeases.leaseType,
      lesseeMemberId: horseLeases.lesseeMemberId,
      lesseeName: clubMembers.displayName,
      lesseeEmail: clubMembers.email,
      monthlyFeeMinor: horseLeases.monthlyFeeMinor,
      currency: horseLeases.currency,
      startDate: horseLeases.startDate,
      endDate: horseLeases.endDate,
      status: horseLeases.status,
      notes: horseLeases.notes,
      createdAt: horseLeases.createdAt,
    })
    .from(horseLeases)
    .innerJoin(
      clubMembers,
      and(eq(horseLeases.lesseeMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .where(and(eq(horseLeases.clubId, clubId), eq(horseLeases.horseId, horseId)))
    .orderBy(desc(horseLeases.createdAt));
}

/**
 * Lessee-side: list leases where the given member is the lessee.
 * Used by the rider portal "My leases" surface.
 */
export async function listLeasesForLessee(clubId: string, lesseeMemberId: string) {
  return db
    .select()
    .from(horseLeases)
    .where(
      and(
        eq(horseLeases.clubId, clubId),
        eq(horseLeases.lesseeMemberId, lesseeMemberId),
      ),
    )
    .orderBy(desc(horseLeases.createdAt));
}

/**
 * Single row lookup with tenant scope. Used by PATCH/end routes
 * before mutation.
 */
export async function getLeaseById(clubId: string, leaseId: string) {
  const rows = await db
    .select()
    .from(horseLeases)
    .where(and(eq(horseLeases.id, leaseId), eq(horseLeases.clubId, clubId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert a lease. Caller validates that horseId and lesseeMemberId
 * resolve to the same club (the composite FKs at the DB layer would
 * reject otherwise, but a friendlier 422 from the route is better
 * UX). Initial status is `pending` — admin reviews then transitions
 * to `active`.
 */
export async function createLease(clubId: string, input: CreateLeaseInput) {
  const rows = await db
    .insert(horseLeases)
    .values({
      clubId,
      horseId: input.horseId,
      lesseeMemberId: input.lesseeMemberId,
      leaseType: input.leaseType,
      monthlyFeeMinor: input.monthlyFeeMinor,
      currency: input.currency,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes,
    })
    .returning();
  return rows[0] ?? null;
}

/**
 * Transition a lease to a terminal status (ended, cancelled) or
 * promote pending → active. `updatedAt` is bumped on every status
 * change so reports can find recently-modified rows.
 *
 * Returns the updated row or null if no row matched (wrong club, or
 * the row was already in the target status — Postgres UPDATE returns
 * 0 rows on a no-op).
 */
export async function setLeaseStatus(
  clubId: string,
  leaseId: string,
  nextStatus: LeaseStatus,
  expectCurrent?: LeaseStatus,
): Promise<{ id: string; status: LeaseStatus } | null> {
  const conditions = [eq(horseLeases.id, leaseId), eq(horseLeases.clubId, clubId)];
  if (expectCurrent) {
    conditions.push(eq(horseLeases.status, expectCurrent));
  }
  // Also refuse a no-op transition — calling code that asks for the
  // current status (e.g., "set to active" when already active) should
  // get null so the route can return 409 instead of silently
  // succeeding. `ne(status, nextStatus)` filters this out.
  conditions.push(ne(horseLeases.status, nextStatus));
  const rows = await db
    .update(horseLeases)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: horseLeases.id, status: horseLeases.status });
  return rows[0] ?? null;
}

/**
 * Find overlapping active leases for the given horse + date range,
 * excluding `excludeLeaseId` (the lease being activated). Used by the
 * activation path to refuse:
 *   - a full lease overlapping with ANY other active lease
 *   - a half lease overlapping with an active FULL lease
 *
 * Two half leases CAN coexist (overlap-allowed). Codex P2 (2026-05-27).
 *
 * Overlap rule: ranges overlap iff `a.start <= b.end AND a.end >= b.start`.
 */
export async function findActiveLeaseConflicts(args: {
  clubId: string;
  horseId: string;
  startDate: string;
  endDate: string;
  candidateType: LeaseType;
  excludeLeaseId: string;
}): Promise<Array<{ id: string; leaseType: LeaseType; startDate: string; endDate: string }>> {
  const baseConditions = and(
    eq(horseLeases.clubId, args.clubId),
    eq(horseLeases.horseId, args.horseId),
    eq(horseLeases.status, 'active'),
    ne(horseLeases.id, args.excludeLeaseId),
    sql`${horseLeases.startDate} <= ${args.endDate}`,
    sql`${horseLeases.endDate} >= ${args.startDate}`,
  );

  // If we're activating a FULL lease, any overlap conflicts.
  // If we're activating a HALF lease, only an existing FULL lease conflicts.
  const typeFilter =
    args.candidateType === 'full'
      ? or(eq(horseLeases.leaseType, 'full'), eq(horseLeases.leaseType, 'half'))
      : eq(horseLeases.leaseType, 'full');

  const rows = await db
    .select({
      id: horseLeases.id,
      leaseType: horseLeases.leaseType,
      startDate: horseLeases.startDate,
      endDate: horseLeases.endDate,
    })
    .from(horseLeases)
    .where(and(baseConditions, typeFilter));
  return rows;
}

/**
 * Atomic activate: codex P2 (2026-05-27) flagged that the
 * find-conflicts-then-update sequence had a race window where two
 * concurrent activations could both pass the conflict query and
 * both promote their lease to `active`, breaking the
 * full-/half-lease exclusivity invariants.
 *
 * This helper wraps the whole transition in a transaction that:
 *   1. SELECT FOR UPDATE on the horse row — serializes every
 *      concurrent activation on the same horse against a single
 *      row-level lock.
 *   2. Re-reads the candidate lease inside the tx.
 *   3. Runs the conflict query (its predicates use the same tx so
 *      reads see anything UPDATE-locked by an earlier-committing
 *      tx).
 *   4. UPDATE lease SET status='active' WHERE id=? AND status='pending'.
 *
 * Return values:
 *   - 'activated': the lease moved from pending to active.
 *   - 'conflict': one or more overlapping active leases found.
 *   - 'not-pending': the lease was already active/ended/cancelled
 *     (the route's earlier transition matrix check should make this
 *     unreachable, but the tx is the source of truth).
 *   - 'not-found': lease or horse missing from the tenant scope.
 */
export type ActivateLeaseResult =
  | { result: 'activated'; id: string }
  | { result: 'conflict'; conflict: { id: string; leaseType: LeaseType; startDate: string; endDate: string } }
  | { result: 'not-pending'; status: LeaseStatus }
  | { result: 'not-found' };

export async function activateLeaseAtomically(
  clubId: string,
  leaseId: string,
): Promise<ActivateLeaseResult> {
  return writeTransaction<ActivateLeaseResult>(async (tx) => {
    // Read the lease first so we know which horse to lock.
    const leaseRows = await tx
      .select({
        id: horseLeases.id,
        horseId: horseLeases.horseId,
        leaseType: horseLeases.leaseType,
        startDate: horseLeases.startDate,
        endDate: horseLeases.endDate,
        status: horseLeases.status,
      })
      .from(horseLeases)
      .where(and(eq(horseLeases.id, leaseId), eq(horseLeases.clubId, clubId)))
      .limit(1);
    const lease = leaseRows[0];
    if (!lease) return { result: 'not-found' };
    if (lease.status !== 'pending') {
      return { result: 'not-pending', status: lease.status as LeaseStatus };
    }

    // Row-level lock on the horse — every concurrent activation for
    // this horse waits here. Mirrors `createCompetitionEntry`'s
    // capacity-check pattern (queries/competitions.ts).
    const horseRows = await tx
      .select({ id: horses.id })
      .from(horses)
      .where(and(eq(horses.id, lease.horseId), eq(horses.clubId, clubId)))
      .for('update')
      .limit(1);
    if (!horseRows[0]) return { result: 'not-found' };

    // Now do the conflict check INSIDE the tx — a concurrent
    // activation that holds the lock above will have committed (or
    // not) by the time our SELECT runs.
    //
    // Rules (codex P2 2026-05-27):
    //   - Full lease vs anything overlapping  → conflict.
    //   - Half lease vs overlapping full      → conflict.
    //   - Half lease vs 0 or 1 other half     → ok (two halves = 100%).
    //   - Half lease vs 2+ active halves       → conflict.
    const typeFilter =
      lease.leaseType === 'full'
        ? or(eq(horseLeases.leaseType, 'full'), eq(horseLeases.leaseType, 'half'))
        : eq(horseLeases.leaseType, 'full');
    const conflicts = await tx
      .select({
        id: horseLeases.id,
        leaseType: horseLeases.leaseType,
        startDate: horseLeases.startDate,
        endDate: horseLeases.endDate,
      })
      .from(horseLeases)
      .where(
        and(
          eq(horseLeases.clubId, clubId),
          eq(horseLeases.horseId, lease.horseId),
          eq(horseLeases.status, 'active'),
          ne(horseLeases.id, leaseId),
          sql`${horseLeases.startDate} <= ${lease.endDate}`,
          sql`${horseLeases.endDate} >= ${lease.startDate}`,
          typeFilter,
        ),
      )
      .limit(1);
    const conflict = conflicts[0];
    if (conflict) {
      return {
        result: 'conflict',
        conflict: {
          id: conflict.id,
          leaseType: conflict.leaseType as LeaseType,
          startDate: conflict.startDate,
          endDate: conflict.endDate,
        },
      };
    }

    // Half-lease cap (codex P2 2026-05-27 — second iteration): two
    // halves sum to 100%. A third active half on a given DAY would
    // mean >100%. We refuse only when there exists a pair of OTHER
    // active half leases that both overlap the candidate AND overlap
    // each other — that pair defines the day where 3 halves would
    // coexist. Disjoint halves spanning a wider candidate window are
    // allowed because no single day reaches 3.
    if (lease.leaseType === 'half') {
      const l1 = horseLeases;
      const l2Alias = sql`horse_leases l2`;
      const pair = await tx.execute(sql`
        SELECT l2.id AS conflict_id,
               l2.lease_type AS conflict_type,
               GREATEST(${l1.startDate}, l2.start_date)::text AS overlap_start,
               LEAST(${l1.endDate}, l2.end_date)::text AS overlap_end
        FROM ${l1}
        INNER JOIN ${l2Alias}
          ON l2.club_id = ${l1.clubId}
         AND l2.horse_id = ${l1.horseId}
         AND l2.lease_type = 'half'
         AND l2.status = 'active'
         AND l2.id <> ${l1.id}
         AND l2.id <> ${leaseId}
         AND l2.start_date <= ${lease.endDate}
         AND l2.end_date >= ${lease.startDate}
         AND l2.start_date <= ${l1.endDate}
         AND l2.end_date >= ${l1.startDate}
        WHERE ${l1.clubId} = ${clubId}
          AND ${l1.horseId} = ${lease.horseId}
          AND ${l1.status} = 'active'
          AND ${l1.leaseType} = 'half'
          AND ${l1.id} <> ${leaseId}
          AND ${l1.startDate} <= ${lease.endDate}
          AND ${l1.endDate} >= ${lease.startDate}
        LIMIT 1
      `);
      const row = (pair as unknown as { rows?: Array<{ conflict_id: string; conflict_type: string; overlap_start: string; overlap_end: string }> }).rows?.[0];
      if (row) {
        return {
          result: 'conflict',
          conflict: {
            id: row.conflict_id,
            leaseType: row.conflict_type as LeaseType,
            startDate: row.overlap_start,
            endDate: row.overlap_end,
          },
        };
      }
    }

    // Update; guarded WHERE on `status='pending'` is belt-and-braces
    // — the FOR UPDATE on the horse should already have serialized
    // us, but the predicate gives a clean no-op if something
    // unexpectedly raced this row outside the lock.
    const updated = await tx
      .update(horseLeases)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(horseLeases.id, leaseId),
          eq(horseLeases.clubId, clubId),
          eq(horseLeases.status, 'pending'),
        ),
      )
      .returning({ id: horseLeases.id });
    const row = updated[0];
    if (!row) return { result: 'not-pending', status: lease.status as LeaseStatus };
    return { result: 'activated', id: row.id };
  });
}

/**
 * Active-lease count per horse for dashboard rollups. Cheap because
 * `idx_horse_leases_club_status` covers the predicate.
 */
export async function countActiveLeasesForClub(clubId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(horseLeases)
    .where(and(eq(horseLeases.clubId, clubId), eq(horseLeases.status, 'active')));
  return rows[0]?.count ?? 0;
}
