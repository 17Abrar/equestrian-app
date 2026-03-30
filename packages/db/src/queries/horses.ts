import { eq, and, isNull, ilike, asc, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import { horses } from '../schema/horses';
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

interface HorseFilters {
  search?: string;
  status?: string;
  skillLevel?: string;
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

  if (filters.search) {
    conditions.push(ilike(horses.name, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(horses)
      .where(where)
      .orderBy(asc(horses.name))
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

export async function getHorseById(clubId: string, horseId: string) {
  const result = await db
    .select({
      id: horses.id,
      clubId: horses.clubId,
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
      createdAt: horses.createdAt,
      updatedAt: horses.updatedAt,
      ownerName: clubMembers.displayName,
    })
    .from(horses)
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
