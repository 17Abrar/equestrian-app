import { eq, and, isNull, ilike, asc, desc, sql, SQL, inArray } from 'drizzle-orm';
import { db, writeTransaction } from '../index';
import { horses } from '../schema/horses';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { bookings, bookingSlots, horsePairingHistory } from '../schema/bookings';
import {
  horseHealthRecords,
  horseMedications,
  horseDocuments,
  horseMedicationLogs,
} from '../schema/horse-health';
import { decryptFields, encryptFields } from '../crypto';
import { escapeLikePattern } from '@equestrian/shared/utils';

// Audit pass-2 (2026-05-09 B-6): freeform fields that reliably collect
// health-history ("scar on left flank from colic surgery", chronic-
// condition catch-all). Encrypted at rest with the same envelope used
// across other PHI columns. `markings` and `notes` are both `text`
// already so no schema-widen migration is needed for these. Reads
// decrypt at every site (list + detail); writes go through
// `encryptFields(data, …)` in `createHorse` / `updateHorse`.
const HORSE_PHI_FIELDS = ['markings', 'notes'] as const;

type NewHorse = typeof horses.$inferInsert;
type DrizzleHorseCreate = Omit<NewHorse, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** Accepts numbers for decimal fields — converts to strings for Drizzle/Postgres */
interface HorseCreate extends Omit<
  DrizzleHorseCreate,
  'heightHands' | 'weightKg' | 'weightLimitKg'
> {
  heightHands?: number | string | null;
  weightKg?: number | string | null;
  weightLimitKg?: number | string | null;
}

type HorseUpdate = Partial<HorseCreate>;

// Audit F-7 (2026-05-06 r3). Pre-fix the helper returned
// `Record<string, unknown>`, which let `db.insert(...).values(payload)`
// accept the loose intermediate via the `as` cast at the call site.
// A new numeric field added to `horses` would silently bypass the
// String() conversion and produce a runtime crash. Returning the
// concrete `DrizzleHorseCreate` (or its partial form) closes that
// hole — adding a new numeric Drizzle column without updating this
// helper now breaks the type.
type DrizzleHorseInsert = Omit<DrizzleHorseCreate, 'heightHands' | 'weightKg' | 'weightLimitKg'> & {
  heightHands?: string | null;
  weightKg?: string | null;
  weightLimitKg?: string | null;
};

function toDecimalStrings<T extends HorseCreate | HorseUpdate>(
  data: T,
): T extends HorseCreate ? DrizzleHorseInsert : Partial<DrizzleHorseInsert> {
  const result: Record<string, unknown> = { ...data };
  if (result.heightHands != null) result.heightHands = String(result.heightHands);
  if (result.weightKg != null) result.weightKg = String(result.weightKg);
  if (result.weightLimitKg != null) result.weightLimitKg = String(result.weightLimitKg);
  return result as never;
}

type OwnershipStatus = 'pending' | 'active' | 'retired' | 'declined';

interface HorseFilters {
  search?: string;
  status?: string;
  skillLevel?: string;
  ownershipStatus?: OwnershipStatus;
  page: number;
  pageSize: number;
}

export async function getHorsesByClub(clubId: string, filters: HorseFilters) {
  const conditions: SQL[] = [eq(horses.clubId, clubId), isNull(horses.deletedAt)];

  if (filters.status) {
    conditions.push(sql`${horses.status} = ${filters.status}`);
  }

  if (filters.skillLevel) {
    conditions.push(sql`${horses.skillLevel} = ${filters.skillLevel}`);
  }

  if (filters.ownershipStatus) {
    conditions.push(eq(horses.ownershipStatus, filters.ownershipStatus));
  }

  if (filters.search) {
    conditions.push(ilike(horses.name, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  // Pending horses are ordered by submission time (newest first) — that's what
  // the admin wants in the approvals queue. Everything else is alphabetical.
  const order =
    filters.ownershipStatus === 'pending' ? desc(horses.ownershipSubmittedAt) : asc(horses.name);

  // Audit F-8 (2026-05-07 r4): the previous `db.select().from(horses)` pulled
  // every column on the wide horses table (~50 columns: insurance numbers,
  // microchip ids, gear notes, markings, photo arrays, etc.) when the list
  // UI consumes ~14. Project only what the active-list card and pending-
  // approval card render — saves multi-KB per response and avoids future
  // decryption cost when encrypted-at-rest medical text fields land. The
  // single-horse detail (`getHorseById`) keeps the wide projection.
  const [data, countResult] = await Promise.all([
    db
      .select({
        id: horses.id,
        clubId: horses.clubId,
        name: horses.name,
        primaryPhotoUrl: horses.primaryPhotoUrl,
        breed: horses.breed,
        gender: horses.gender,
        color: horses.color,
        heightHands: horses.heightHands,
        weightKg: horses.weightKg,
        status: horses.status,
        skillLevel: horses.skillLevel,
        weightLimitKg: horses.weightLimitKg,
        notes: horses.notes,
        ownerMemberId: horses.ownerMemberId,
        ownershipStatus: horses.ownershipStatus,
        ownershipSubmittedAt: horses.ownershipSubmittedAt,
        ownerName: clubMembers.displayName,
        createdAt: horses.createdAt,
        updatedAt: horses.updatedAt,
      })
      .from(horses)
      .leftJoin(
        clubMembers,
        and(eq(horses.ownerMemberId, clubMembers.id), eq(clubMembers.clubId, horses.clubId)),
      )
      .where(where)
      .orderBy(order)
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horses)
      .where(where),
  ]);

  return {
    // Audit pass-2 B-6: decrypt `notes` per row. The list projection
    // doesn't include `markings`, so only `notes` is decrypted here.
    data: data.map((row) => ({
      ...row,
      notes: decryptFields({ notes: row.notes }, ['notes'] as const).notes,
    })),
    total: countResult[0]?.count ?? 0,
  };
}

// Audit F-21 (2026-05-07 r4): export row type derived from the projection
// so api-client / hook consumers can `import type { HorseListRow }` instead
// of redeclaring inline. Starter pattern — wider rollout deferred.
export type HorseListRow = Awaited<ReturnType<typeof getHorsesByClub>>['data'][number];

/** Cheap count for the admin "Pending approvals" badge. */
export async function getPendingOwnershipCount(clubId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(horses)
    .where(
      and(
        eq(horses.clubId, clubId),
        eq(horses.ownershipStatus, 'pending'),
        isNull(horses.deletedAt),
      ),
    );
  return result[0]?.count ?? 0;
}

export async function getHorseById(clubId: string, horseId: string) {
  const result = await db
    .select({
      id: horses.id,
      clubId: horses.clubId,
      clubCurrency: clubs.currency,
      ownerMemberId: horses.ownerMemberId,
      name: horses.name,
      barnName: horses.barnName,
      breed: horses.breed,
      gender: horses.gender,
      dateOfBirth: horses.dateOfBirth,
      color: horses.color,
      heightHands: horses.heightHands,
      weightKg: horses.weightKg,
      markings: horses.markings,
      microchipNumber: horses.microchipNumber,
      passportNumber: horses.passportNumber,
      registrationNumber: horses.registrationNumber,
      status: horses.status,
      skillLevel: horses.skillLevel,
      temperament: horses.temperament,
      weightLimitKg: horses.weightLimitKg,
      minRiderAge: horses.minRiderAge,
      maxLessonsPerDay: horses.maxLessonsPerDay,
      mandatoryRestDays: horses.mandatoryRestDays,
      saleStatus: horses.saleStatus,
      purchasePrice: horses.purchasePrice,
      currentValue: horses.currentValue,
      salePrice: horses.salePrice,
      saddleSize: horses.saddleSize,
      girthSize: horses.girthSize,
      bridleSize: horses.bridleSize,
      bitType: horses.bitType,
      bitSize: horses.bitSize,
      blanketSize: horses.blanketSize,
      bootsSize: horses.bootsSize,
      gearNotes: horses.gearNotes,
      insuranceProvider: horses.insuranceProvider,
      insurancePolicyNumber: horses.insurancePolicyNumber,
      insuranceCoverage: horses.insuranceCoverage,
      insuranceExpiry: horses.insuranceExpiry,
      primaryPhotoUrl: horses.primaryPhotoUrl,
      photoUrls: horses.photoUrls,
      notes: horses.notes,
      ownershipStatus: horses.ownershipStatus,
      monthlyLiveryFeeMinor: horses.monthlyLiveryFeeMinor,
      liveryStartDate: horses.liveryStartDate,
      liveryEndDate: horses.liveryEndDate,
      ownershipDeclineReason: horses.ownershipDeclineReason,
      ownershipSubmittedAt: horses.ownershipSubmittedAt,
      createdAt: horses.createdAt,
      updatedAt: horses.updatedAt,
      ownerName: clubMembers.displayName,
      ownerEmail: clubMembers.email,
      ownerClerkUserId: clubMembers.clerkUserId,
    })
    .from(horses)
    .innerJoin(clubs, eq(clubs.id, horses.clubId))
    .leftJoin(clubMembers, eq(horses.ownerMemberId, clubMembers.id))
    .where(
      and(
        eq(horses.id, horseId),
        eq(horses.clubId, clubId),
        isNull(horses.deletedAt),
        // Soft-deleted clubs (Clerk org.deleted) shouldn't surface their
        // horses anywhere — see audit F-1.
        isNull(clubs.deletedAt),
      ),
    )
    .limit(1);

  const row = result[0];
  if (!row) return null;
  // Audit pass-2 B-6: decrypt PHI fields on detail read.
  return decryptFields(row, HORSE_PHI_FIELDS);
}

export async function createHorse(clubId: string, data: HorseCreate) {
  // Audit pass-2 B-6: encrypt PHI fields before write. The double
  // `unknown` cast threads through `encryptFields<T extends Record
  // <string, unknown>>` — interface types like `HorseCreate` don't
  // carry an index signature, but the helper only touches the named
  // string fields.
  const encrypted = encryptFields(
    data as unknown as Record<string, unknown>,
    HORSE_PHI_FIELDS as readonly string[],
  ) as unknown as HorseCreate;
  const values = { ...toDecimalStrings(data), ...encrypted, clubId } as NewHorse;
  const result = await db.insert(horses).values(values).returning();
  const row = result[0];
  return row ? decryptFields(row, HORSE_PHI_FIELDS) : row;
}

export async function updateHorse(clubId: string, horseId: string, data: HorseUpdate) {
  // Audit pass-2 B-6: encrypt PHI fields. `encryptFields` only writes
  // keys present in `data`, so PATCH semantics (omitted = leave alone)
  // are preserved.
  const encrypted = encryptFields(
    data as unknown as Record<string, unknown>,
    HORSE_PHI_FIELDS as readonly string[],
  ) as unknown as HorseUpdate;
  const values = {
    ...toDecimalStrings(data),
    ...encrypted,
    updatedAt: new Date(),
  } as Partial<NewHorse>;

  // Encode legal operational-status transitions at the SQL gate (audit E-2).
  // `retired` and `sold` are terminal — once a horse is in either state, the
  // generic PATCH must not flip it back to available/resting/etc., because
  // doing so silently bypasses the ownership lifecycle (`retireHorseOwnership`
  // / sale audit) and lets matching pick a horse that's been removed from the
  // school string. Updates that don't touch `status` (name, gear, photos)
  // still work on terminal rows so admins can fix typos.
  const conditions = [eq(horses.id, horseId), eq(horses.clubId, clubId), isNull(horses.deletedAt)];
  if (values.status !== undefined) {
    conditions.push(sql`${horses.status} NOT IN ('retired', 'sold')`);
  }

  const result = await db
    .update(horses)
    .set(values)
    .where(and(...conditions))
    .returning();

  const row = result[0];
  if (!row) return null;
  // Audit pass-2 B-6: decrypt PHI fields before returning so PATCH
  // responses stay symmetric with detail GETs.
  return decryptFields(row, HORSE_PHI_FIELDS);
}

export async function getAvailableHorsesForMatching(
  clubId: string,
  date: string,
  // Optional rider filter (audit G-14). When set, the pairing-history pull
  // narrows to just this rider's prior pairings instead of loading every
  // (rider, horse, rating) tuple in the club's history. The matching
  // algorithm only consumes the calling rider's pairings anyway.
  // Optional for back-compat: callers that don't supply it pay the same
  // perf cost as before.
  riderMemberId?: string,
) {
  // Audit F-58 (2026-05-07 r4): project only the columns the matcher
  // consumes (~9 of 55). Same pattern as F-8 on the list view — keeps
  // payload small on every booking-creation path and removes future
  // decryption cost when encrypted-at-rest medical fields land.
  const availableHorses = await db
    .select({
      id: horses.id,
      name: horses.name,
      status: horses.status,
      skillLevel: horses.skillLevel,
      weightLimitKg: horses.weightLimitKg,
      minRiderAge: horses.minRiderAge,
      maxLessonsPerDay: horses.maxLessonsPerDay,
      mandatoryRestDays: horses.mandatoryRestDays,
      temperament: horses.temperament,
    })
    .from(horses)
    .where(
      and(
        eq(horses.clubId, clubId),
        eq(horses.status, 'available'),
        // Only match horses the club actually owns (or whose owners have been
        // approved). Pending / declined / retired horses should never be
        // auto-matched to riders.
        eq(horses.ownershipStatus, 'active'),
        isNull(horses.deletedAt),
      ),
    );

  // Get today's booking counts AND actual booked time slots per horse.
  // Bind the join to bookingSlots.clubId as well as slotId — without it,
  // a (mis)booking row pointing at a foreign club's slot would surface
  // that slot's time as occupying this club's horse. Audit H-4.
  const todayBookingRows = await db
    .select({
      horseId: bookings.horseId,
      startTime: bookingSlots.startTime,
    })
    .from(bookings)
    .innerJoin(
      bookingSlots,
      and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
    )
    .where(
      and(
        eq(bookings.clubId, clubId),
        sql`${bookingSlots.date} = ${date}`,
        sql`${bookings.status} != 'cancelled'`,
      ),
    );

  const bookingCountMap = new Map<string, number>();
  const bookedSlotsMap = new Map<string, string[]>();
  for (const row of todayBookingRows) {
    if (row.horseId) {
      bookingCountMap.set(row.horseId, (bookingCountMap.get(row.horseId) ?? 0) + 1);
      if (!bookedSlotsMap.has(row.horseId)) {
        bookedSlotsMap.set(row.horseId, []);
      }
      bookedSlotsMap.get(row.horseId)!.push(`${date}T${row.startTime}`);
    }
  }

  // Inner-join `horses` and gate on `isNull(horses.deletedAt)` so pairings
  // belonging to soft-deleted horses don't surface — audit C-10. The
  // soft-delete is the GDPR/right-to-be-forgotten signal; without this
  // gate, a pairing for a transferred or retired horse would still leak
  // rider history into the matching engine.
  const pairingHistory = await db
    .select({
      horseId: horsePairingHistory.horseId,
      riderId: horsePairingHistory.riderMemberId,
      rating: horsePairingHistory.rating,
    })
    .from(horsePairingHistory)
    .innerJoin(horses, and(eq(horses.id, horsePairingHistory.horseId), eq(horses.clubId, clubId)))
    .where(
      and(
        eq(horsePairingHistory.clubId, clubId),
        isNull(horses.deletedAt),
        riderMemberId ? eq(horsePairingHistory.riderMemberId, riderMemberId) : undefined,
      ),
    );

  const pairingMap = new Map<string, Array<{ riderId: string; rating: number }>>();
  for (const row of pairingHistory) {
    if (!pairingMap.has(row.horseId)) {
      pairingMap.set(row.horseId, []);
    }
    if (row.rating !== null) {
      pairingMap.get(row.horseId)!.push({ riderId: row.riderId, rating: row.rating });
    }
  }

  return availableHorses.map((horse) => ({
    id: horse.id,
    name: horse.name,
    status: horse.status,
    skillLevel: horse.skillLevel as 'beginner' | 'intermediate' | 'advanced',
    // 0 = no weight limit configured; the matching algorithm skips the weight filter for 0
    weightLimit: horse.weightLimitKg ? Number(horse.weightLimitKg) : 0,
    minRiderAge: horse.minRiderAge ?? 0,
    maxLessonsPerDay: horse.maxLessonsPerDay,
    lessonsToday: bookingCountMap.get(horse.id) ?? 0,
    temperament: horse.temperament ?? [],
    bookedSlots: bookedSlotsMap.get(horse.id) ?? [],
    pairingHistory: pairingMap.get(horse.id) ?? [],
  }));
}

// Audit F-21 (2026-05-07 r4): exported row type so consumers can import the
// shape instead of redeclaring it.
export type HorseAvailableForMatching = Awaited<
  ReturnType<typeof getAvailableHorsesForMatching>
>[number];

export async function softDeleteHorse(clubId: string, horseId: string) {
  // Audit pass-3 follow-up E (2026-05-09): soft-delete cascades to every
  // medical PHI child table — health records, medications, medication
  // logs, documents. Each child table's schema-level FK declares
  // `ON DELETE CASCADE` against horses, but that only fires on hard
  // delete; soft-delete bypassed it and left medical PHI live
  // indefinitely. Three failure modes the cascade closes:
  //   1. GDPR right-to-erasure not honoured for medical records.
  //   2. A future query that forgets `isHorseActiveInClub` would leak.
  //   3. A hard-purge later silently CASCADE-deleted the children
  //      unexpectedly.
  //
  // Audit 2026-05-13 (P1 — appended): `horse_medication_logs` is
  // documented as append-only (DATABASE.md "Append-only tables"). The
  // PHI scrub here is an INTENTIONAL EXCEPTION to that invariant —
  // GDPR right-to-erasure trumps append-only retention for medical
  // PHI. Documented in DATABASE.md alongside the append-only list.
  //
  // `horse_pairing_history` is also append-only BUT contains NO PHI
  // (rider_member_id + rating only) — it's behavioral signal for the
  // smart-matching algorithm. The previous cascade hard-DELETEd it,
  // which corrupted the matching model AND broke the append-only
  // invariant with no GDPR justification. As of 2026-05-13 we leave
  // `horse_pairing_history` rows alone on soft-delete; they continue
  // to inform pairings even after the horse is retired. If the parent
  // horse is later hard-deleted (rare; club deletion only), the FK
  // CASCADE will sweep them then — which is consistent with append-only
  // semantics (a removed parent removes its history).
  //
  // Wrapped in a writeTransaction so the parent UPDATE and the child
  // DELETEs commit atomically — a partial failure can't leave the
  // horse soft-deleted with medical rows orphaned (or vice versa).
  // horse_medication_logs has an FK CASCADE on horse_medications, so
  // deleting medications technically catches logs too — but explicit
  // is safer (defends against a future schema reviewer dropping the
  // CASCADE) and clearer in the log trail.
  return writeTransaction(async (tx) => {
    const result = await tx
      .update(horses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(horses.id, horseId), eq(horses.clubId, clubId), isNull(horses.deletedAt)))
      .returning({ id: horses.id });

    if (!result[0]) {
      return null;
    }

    // Order matters only for foreign-key chains: horse_medication_logs
    // → horse_medications. Delete logs first so the medications delete
    // doesn't trigger a cascade we're already doing explicitly.
    await tx
      .delete(horseMedicationLogs)
      .where(and(eq(horseMedicationLogs.clubId, clubId), eq(horseMedicationLogs.horseId, horseId)));
    await tx
      .delete(horseMedications)
      .where(and(eq(horseMedications.clubId, clubId), eq(horseMedications.horseId, horseId)));
    await tx
      .delete(horseHealthRecords)
      .where(and(eq(horseHealthRecords.clubId, clubId), eq(horseHealthRecords.horseId, horseId)));
    await tx
      .delete(horseDocuments)
      .where(and(eq(horseDocuments.clubId, clubId), eq(horseDocuments.horseId, horseId)));
    // horse_pairing_history INTENTIONALLY preserved — see header comment.

    return result[0];
  });
}

// ─── Ownership registration (Round 8) ─────────────────────────────────

interface RegisterOwnershipInput {
  clubId: string;
  clerkUserId: string;
  name: string;
  breed?: string;
  gender?: string;
  dateOfBirth?: string;
  color?: string;
  heightHands?: number;
  weightKg?: number;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  primaryPhotoUrl?: string;
  notes?: string;
}

/**
 * Rider self-registers a horse. We look up the rider's `club_members.id` from
 * their Clerk ID + target club before insert — storing the Clerk ID directly
 * in `owner_member_id` (a UUID column) would crash at runtime. If the user
 * isn't a member of the target club, returns `null` so the caller can 403.
 *
 * The horse is created with `ownership_status = 'pending'` (awaiting admin
 * review). Operational `status` defaults to `available` but matching queries
 * gate on ownership_status = 'active' so pending horses never appear in
 * auto-match until approved.
 */
export async function registerHorseOwnership(input: RegisterOwnershipInput) {
  const member = await db
    .select({
      id: clubMembers.id,
      displayName: clubMembers.displayName,
      email: clubMembers.email,
      role: clubMembers.role,
    })
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.clubId, input.clubId),
        eq(clubMembers.clerkUserId, input.clerkUserId),
        eq(clubMembers.isActive, true),
      ),
    )
    .limit(1);

  if (!member[0]) return null;

  // Audit HIGH-1 (2026-05-05): the route's `requiredPermission`
  // (`horses:register_own`) is checked against the caller's ACTIVE
  // club, but `input.clubId` here is the TARGET club from the body.
  // A user who is rider at A and coach at B passes the route gate
  // (rider grant from active org A) and arrives here. We must
  // re-validate the target-club role — only `rider` and `horse_owner`
  // can register ownership; allowing `coach`/`groom`/etc. would let
  // staff plant horses they shouldn't own.
  if (member[0].role !== 'rider' && member[0].role !== 'horse_owner') {
    throw new Error('OWNERSHIP_ROLE_NOT_ALLOWED');
  }

  const values: NewHorse = {
    clubId: input.clubId,
    ownerMemberId: member[0].id,
    name: input.name,
    breed: input.breed,
    gender: input.gender,
    dateOfBirth: input.dateOfBirth,
    color: input.color,
    // Drizzle numeric columns expect strings (see CLAUDE.md pitfall #4).
    heightHands: input.heightHands != null ? String(input.heightHands) : null,
    weightKg: input.weightKg != null ? String(input.weightKg) : null,
    skillLevel: input.skillLevel,
    primaryPhotoUrl: input.primaryPhotoUrl,
    notes: input.notes,
    ownershipStatus: 'pending',
    ownershipSubmittedAt: new Date(),
  };

  const result = await db.insert(horses).values(values).returning();
  return result[0]
    ? {
        ...result[0],
        ownerDisplayName: member[0].displayName,
        ownerEmail: member[0].email,
      }
    : undefined;
}

interface ApproveOwnershipInput {
  monthlyLiveryFeeMinor: number;
  liveryStartDate: string;
}

export async function approveHorseOwnership(
  clubId: string,
  horseId: string,
  input: ApproveOwnershipInput,
) {
  const result = await db
    .update(horses)
    .set({
      ownershipStatus: 'active',
      monthlyLiveryFeeMinor: input.monthlyLiveryFeeMinor,
      liveryStartDate: input.liveryStartDate,
      ownershipDeclineReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(horses.id, horseId),
        eq(horses.clubId, clubId),
        eq(horses.ownershipStatus, 'pending'),
        isNull(horses.deletedAt),
      ),
    )
    .returning();

  return result[0] ?? null;
}

export async function declineHorseOwnership(clubId: string, horseId: string, reason: string) {
  const result = await db
    .update(horses)
    .set({
      ownershipStatus: 'declined',
      ownershipDeclineReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(horses.id, horseId),
        eq(horses.clubId, clubId),
        eq(horses.ownershipStatus, 'pending'),
        isNull(horses.deletedAt),
      ),
    )
    .returning();

  return result[0] ?? null;
}

export async function retireHorseOwnership(
  clubId: string,
  horseId: string,
  liveryEndDate?: string,
) {
  const result = await db
    .update(horses)
    .set({
      ownershipStatus: 'retired',
      // If the admin didn't supply an end date, snapshot today. The livery
      // billing cron (Round 8.5) needs a definitive end date to stop prorating.
      liveryEndDate: liveryEndDate ?? new Date().toISOString().slice(0, 10),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(horses.id, horseId),
        eq(horses.clubId, clubId),
        eq(horses.ownershipStatus, 'active'),
        isNull(horses.deletedAt),
      ),
    )
    .returning();

  return result[0] ?? null;
}

/**
 * Rider-facing "My Horses". Returns every horse the Clerk user owns across
 * every club they're a member of — riders can own horses at multiple stables.
 */
export async function getHorsesOwnedByUser(
  clerkUserId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const where = and(
    eq(clubMembers.clerkUserId, clerkUserId),
    eq(clubMembers.isActive, true),
    isNull(horses.deletedAt),
    // Don't surface a tombstoned club's horses in "My horses" — F-1.
    isNull(clubs.deletedAt),
  );
  const [items, count] = await Promise.all([
    db
      .select({
        id: horses.id,
        clubId: horses.clubId,
        clubName: clubs.name,
        clubSlug: clubs.slug,
        clubCurrency: clubs.currency,
        name: horses.name,
        breed: horses.breed,
        gender: horses.gender,
        color: horses.color,
        heightHands: horses.heightHands,
        weightKg: horses.weightKg,
        skillLevel: horses.skillLevel,
        primaryPhotoUrl: horses.primaryPhotoUrl,
        status: horses.status,
        ownershipStatus: horses.ownershipStatus,
        monthlyLiveryFeeMinor: horses.monthlyLiveryFeeMinor,
        liveryStartDate: horses.liveryStartDate,
        liveryEndDate: horses.liveryEndDate,
        ownershipDeclineReason: horses.ownershipDeclineReason,
        ownershipSubmittedAt: horses.ownershipSubmittedAt,
        createdAt: horses.createdAt,
      })
      .from(horses)
      .innerJoin(
        clubMembers,
        and(eq(horses.ownerMemberId, clubMembers.id), eq(clubMembers.clubId, horses.clubId)),
      )
      .innerJoin(clubs, eq(horses.clubId, clubs.id))
      .where(where)
      .orderBy(desc(horses.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horses)
      .innerJoin(
        clubMembers,
        and(eq(horses.ownerMemberId, clubMembers.id), eq(clubMembers.clubId, horses.clubId)),
      )
      .innerJoin(clubs, eq(horses.clubId, clubs.id))
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

/** Clubs the signed-in rider belongs to — used to populate the registration form's stable selector. */
export async function getActiveMembershipsForUser(clerkUserId: string) {
  return db
    .select({
      memberId: clubMembers.id,
      clubId: clubs.id,
      clubName: clubs.name,
      clubSlug: clubs.slug,
      role: clubMembers.role,
    })
    .from(clubMembers)
    .innerJoin(clubs, eq(clubMembers.clubId, clubs.id))
    .where(
      and(
        eq(clubMembers.clerkUserId, clerkUserId),
        eq(clubMembers.isActive, true),
        isNull(clubs.deletedAt),
      ),
    )
    .orderBy(asc(clubs.name));
}

/**
 * Confirms a Clerk user is the registered owner of a horse. Returns the
 * horse's `clubId` and `ownershipStatus` so the caller can audit correctly
 * and decide whether the transition is legal. Returns null for mismatches
 * (wrong owner, soft-deleted, nonexistent).
 */
export async function getHorseOwnershipByUser(clerkUserId: string, horseId: string) {
  const result = await db
    .select({
      horseId: horses.id,
      clubId: horses.clubId,
      ownershipStatus: horses.ownershipStatus,
    })
    .from(horses)
    .innerJoin(
      clubMembers,
      and(eq(horses.ownerMemberId, clubMembers.id), eq(clubMembers.clubId, horses.clubId)),
    )
    .where(
      and(
        eq(horses.id, horseId),
        eq(clubMembers.clerkUserId, clerkUserId),
        eq(clubMembers.isActive, true),
        isNull(horses.deletedAt),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

// Used by the submission email so we can address admins by name. Kept here
// rather than in clubs.ts because it's specific to the approval-notification
// flow (don't leak all admins to unrelated callers).
export async function getClubAdminEmails(clubId: string) {
  const admins = await db
    .select({ email: clubMembers.email, displayName: clubMembers.displayName })
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.isActive, true),
        inArray(clubMembers.role, ['club_admin', 'club_manager']),
      ),
    );
  return admins.filter((a): a is { email: string; displayName: string | null } => !!a.email);
}
