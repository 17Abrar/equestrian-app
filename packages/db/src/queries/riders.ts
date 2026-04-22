import { eq, and, ilike, asc, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import { riderProfiles } from '../schema/rider-profiles';
import { clubMembers } from '../schema/club-members';
import { escapeLikePattern } from '@equestrian/shared/utils';
import { randomUUID } from 'crypto';

type NewRiderProfile = typeof riderProfiles.$inferInsert;
type DrizzleRiderUpdate = Partial<Omit<NewRiderProfile, 'id' | 'clubId' | 'memberId' | 'createdAt' | 'updatedAt'>>;

/** Accepts numbers for decimal fields — converts to strings for Drizzle/Postgres */
interface RiderProfileUpdate extends Omit<DrizzleRiderUpdate, 'weightKg' | 'heightCm'> {
  weightKg?: number | string | null;
  heightCm?: number | string | null;
}

function toRiderDecimalStrings(data: RiderProfileUpdate): Record<string, unknown> {
  const result = { ...data };
  if (result.weightKg != null) result.weightKg = String(result.weightKg);
  if (result.heightCm != null) result.heightCm = String(result.heightCm);
  return result;
}

interface RiderFilters {
  search?: string;
  skillLevel?: string;
  page: number;
  pageSize: number;
}

export async function getRidersByClub(clubId: string, filters: RiderFilters) {
  const conditions: SQL[] = [
    eq(riderProfiles.clubId, clubId),
  ];

  if (filters.skillLevel) {
    conditions.push(sql`${riderProfiles.skillLevel} = ${filters.skillLevel}`);
  }

  if (filters.search) {
    conditions.push(ilike(clubMembers.displayName, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: riderProfiles.id,
        clubId: riderProfiles.clubId,
        memberId: riderProfiles.memberId,
        dateOfBirth: riderProfiles.dateOfBirth,
        weightKg: riderProfiles.weightKg,
        heightCm: riderProfiles.heightCm,
        skillLevel: riderProfiles.skillLevel,
        emergencyContactName: riderProfiles.emergencyContactName,
        emergencyContactPhone: riderProfiles.emergencyContactPhone,
        emergencyContactRelation: riderProfiles.emergencyContactRelation,
        medicalNotes: riderProfiles.medicalNotes,
        totalLessonsCompleted: riderProfiles.totalLessonsCompleted,
        parentMemberId: riderProfiles.parentMemberId,
        createdAt: riderProfiles.createdAt,
        updatedAt: riderProfiles.updatedAt,
        displayName: clubMembers.displayName,
        email: clubMembers.email,
        phone: clubMembers.phone,
      })
      .from(riderProfiles)
      .innerJoin(clubMembers, eq(riderProfiles.memberId, clubMembers.id))
      .where(where)
      .orderBy(asc(clubMembers.displayName))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(riderProfiles)
      .innerJoin(clubMembers, eq(riderProfiles.memberId, clubMembers.id))
      .where(where),
  ]);

  return {
    data,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getRiderById(clubId: string, riderId: string) {
  const result = await db
    .select({
      id: riderProfiles.id,
      clubId: riderProfiles.clubId,
      memberId: riderProfiles.memberId,
      dateOfBirth: riderProfiles.dateOfBirth,
      weightKg: riderProfiles.weightKg,
      heightCm: riderProfiles.heightCm,
      skillLevel: riderProfiles.skillLevel,
      emergencyContactName: riderProfiles.emergencyContactName,
      emergencyContactPhone: riderProfiles.emergencyContactPhone,
      emergencyContactRelation: riderProfiles.emergencyContactRelation,
      medicalNotes: riderProfiles.medicalNotes,
      totalLessonsCompleted: riderProfiles.totalLessonsCompleted,
      parentMemberId: riderProfiles.parentMemberId,
      createdAt: riderProfiles.createdAt,
      updatedAt: riderProfiles.updatedAt,
      displayName: clubMembers.displayName,
      email: clubMembers.email,
      phone: clubMembers.phone,
    })
    .from(riderProfiles)
    .innerJoin(clubMembers, eq(riderProfiles.memberId, clubMembers.id))
    .where(and(eq(riderProfiles.id, riderId), eq(riderProfiles.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

export async function getRiderByMemberId(clubId: string, memberId: string) {
  const result = await db
    .select({
      id: riderProfiles.id,
      clubId: riderProfiles.clubId,
      memberId: riderProfiles.memberId,
      dateOfBirth: riderProfiles.dateOfBirth,
      weightKg: riderProfiles.weightKg,
      heightCm: riderProfiles.heightCm,
      skillLevel: riderProfiles.skillLevel,
      totalLessonsCompleted: riderProfiles.totalLessonsCompleted,
      parentMemberId: riderProfiles.parentMemberId,
      displayName: clubMembers.displayName,
    })
    .from(riderProfiles)
    .innerJoin(clubMembers, eq(riderProfiles.memberId, clubMembers.id))
    .where(and(eq(riderProfiles.memberId, memberId), eq(riderProfiles.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

interface CreateRiderData {
  displayName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  weightKg?: number | string;
  heightCm?: number | string;
  skillLevel: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  medicalNotes?: string;
}

/**
 * Creates a rider: inserts a club_member (role: rider) + rider_profile in one
 * transaction. Manually-created riders get a placeholder clerkUserId until
 * they sign up. Must be called inside `runInTenantContext`.
 */
export async function createRider(clubId: string, data: CreateRiderData) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(clubMembers)
      .values({
        clubId,
        clerkUserId: `manual_${randomUUID()}`,
        role: 'rider',
        displayName: data.displayName,
        email: data.email,
        phone: data.phone,
      })
      .returning();

    if (!member) throw new Error('Failed to create member');

    const [profile] = await tx
      .insert(riderProfiles)
      .values({
        clubId,
        memberId: member.id,
        dateOfBirth: data.dateOfBirth,
        weightKg: data.weightKg != null ? String(data.weightKg) : null,
        heightCm: data.heightCm != null ? String(data.heightCm) : null,
        skillLevel: data.skillLevel as 'beginner' | 'intermediate' | 'advanced',
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        emergencyContactRelation: data.emergencyContactRelation,
        medicalNotes: data.medicalNotes,
      })
      .returning();

    return { member, profile };
  });
}

export async function updateRiderProfile(clubId: string, riderId: string, data: RiderProfileUpdate) {
  const values = { ...toRiderDecimalStrings(data), updatedAt: new Date() } as Partial<NewRiderProfile>;
  const result = await db
    .update(riderProfiles)
    .set(values)
    .where(and(eq(riderProfiles.id, riderId), eq(riderProfiles.clubId, clubId)))
    .returning();

  return result[0] ?? null;
}
