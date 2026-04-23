import { eq, and, isNull, ilike, asc, desc, sql, SQL, inArray } from 'drizzle-orm';
import { db } from '../index';
import { horses } from '../schema/horses';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { bookings, bookingSlots, horsePairingHistory } from '../schema/bookings';
import { escapeLikePattern } from '@equestrian/shared/utils';

type NewHorse = typeof horses.$inferInsert;
type DrizzleHorseCreate = Omit<NewHorse, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** Accepts numbers for decimal fields — converts to strings for Drizzle/Postgres */
interface HorseCreate extends Omit<DrizzleHorseCreate, 'heightHands' | 'weightKg' | 'weightLimitKg'> {
  heightHands?: number | string | null;
  weightKg?: number | string | null;
  weightLimitKg?: number | string | null;
}

type HorseUpdate = Partial<HorseCreate>;

function toDecimalStrings(data: HorseCreate | HorseUpdate): Record<string, unknown> {
  const result = { ...data };
  if (result.heightHands != null) result.heightHands = String(result.heightHands);
  if (result.weightKg != null) result.weightKg = String(result.weightKg);
  if (result.weightLimitKg != null) result.weightLimitKg = String(result.weightLimitKg);
  return result;
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
  const conditions: SQL[] = [
    eq(horses.clubId, clubId),
    isNull(horses.deletedAt),
  ];

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
  const order = filters.ownershipStatus === 'pending'
    ? desc(horses.ownershipSubmittedAt)
    : asc(horses.name);

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(horses)
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
    data,
    total: countResult[0]?.count ?? 0,
  };
}

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
    .where(and(eq(horses.id, horseId), eq(horses.clubId, clubId), isNull(horses.deletedAt)))
    .limit(1);

  return result[0] ?? null;
}

export async function createHorse(clubId: string, data: HorseCreate) {
  const values = { ...toDecimalStrings(data), clubId } as NewHorse;
  const result = await db.insert(horses).values(values).returning();
  return result[0];
}

export async function updateHorse(clubId: string, horseId: string, data: HorseUpdate) {
  const values = { ...toDecimalStrings(data), updatedAt: new Date() } as Partial<NewHorse>;
  const result = await db
    .update(horses)
    .set(values)
    .where(and(eq(horses.id, horseId), eq(horses.clubId, clubId), isNull(horses.deletedAt)))
    .returning();

  return result[0] ?? null;
}

export async function getAvailableHorsesForMatching(clubId: string, date: string) {
  const availableHorses = await db
    .select()
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

  // Get today's booking counts AND actual booked time slots per horse
  const todayBookingRows = await db
    .select({
      horseId: bookings.horseId,
      startTime: bookingSlots.startTime,
    })
    .from(bookings)
    .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
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

  const pairingHistory = await db
    .select({
      horseId: horsePairingHistory.horseId,
      riderId: horsePairingHistory.riderMemberId,
      rating: horsePairingHistory.rating,
    })
    .from(horsePairingHistory)
    .where(eq(horsePairingHistory.clubId, clubId));

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

export async function softDeleteHorse(clubId: string, horseId: string) {
  const result = await db
    .update(horses)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(horses.id, horseId), eq(horses.clubId, clubId), isNull(horses.deletedAt)))
    .returning({ id: horses.id });

  return result[0] ?? null;
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

export async function declineHorseOwnership(
  clubId: string,
  horseId: string,
  reason: string,
) {
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
export async function getHorsesOwnedByUser(clerkUserId: string) {
  return db
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
    .innerJoin(clubMembers, eq(horses.ownerMemberId, clubMembers.id))
    .innerJoin(clubs, eq(horses.clubId, clubs.id))
    .where(
      and(
        eq(clubMembers.clerkUserId, clerkUserId),
        eq(clubMembers.isActive, true),
        isNull(horses.deletedAt),
      ),
    )
    .orderBy(desc(horses.createdAt));
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
    .innerJoin(clubMembers, eq(horses.ownerMemberId, clubMembers.id))
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
