import { randomUUID } from 'node:crypto';
import { eq, and, ilike, asc, sql, type SQL } from 'drizzle-orm';
import { db, writeTransaction } from '../index';
import { riderProfiles } from '../schema/rider-profiles';
import { clubMembers } from '../schema/club-members';
import { decryptFields, encryptFields } from '../crypto';
import { escapeLikePattern } from '@equestrian/shared/utils';

// Audit MED-3 (2026-05-05) + HIGH-3 (2026-05-05 pass 2) + pass-2
// (2026-05-09 B-1): rider PHI/PII at rest. Encrypted with AES-256-GCM
// via `encryptFields` / `decryptFields` (`v1:` + base64(IV || tag ||
// ct)). All four fields below land in the audit blast radius (a Neon
// backup leak, a Drizzle Studio session) and now share the same
// envelope. The medicalNotes encryption shipped first (audit MED-3);
// the pass-2 sweep adds the emergency-contact trio.
//
// Two paths matter:
//   1. New writes — `createRider`, `updateRiderProfile`,
//      `upsertRiderProfileByMember` below all run `encryptFields`
//      before handing values to Drizzle.
//   2. Pre-encryption plaintext rows — `scripts/backfill-pass-2-phi.mjs`
//      encrypts in-place using the same AES-GCM envelope; verifier
//      migration `0053_audit_pass_2_phi_verifier.sql` aborts deploys
//      until the backfill has run. `0034_rider_medical_notes_backfill.sql`
//      covers the older medical-notes case.
const RIDER_PROFILE_ENCRYPTED_FIELDS = [
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'medicalNotes',
] as const;

type NewRiderProfile = typeof riderProfiles.$inferInsert;
type DrizzleRiderUpdate = Partial<
  Omit<NewRiderProfile, 'id' | 'clubId' | 'memberId' | 'createdAt' | 'updatedAt'>
>;

/** Accepts numbers for decimal fields — converts to strings for Drizzle/Postgres */
interface RiderProfileUpdate extends Omit<DrizzleRiderUpdate, 'weightKg' | 'heightCm'> {
  weightKg?: number | string | null;
  heightCm?: number | string | null;
}

// Audit F-7 (2026-05-06 r3). Concrete return type — see horses.ts
// for rationale. Adding a new numeric column without updating this
// helper now breaks the type.
type DrizzleRiderProfileUpdate = Omit<DrizzleRiderUpdate, 'weightKg' | 'heightCm'> & {
  weightKg?: string | null;
  heightCm?: string | null;
};

function toRiderDecimalStrings(data: RiderProfileUpdate): DrizzleRiderProfileUpdate {
  const result: Record<string, unknown> = { ...data };
  if (result.weightKg != null) result.weightKg = String(result.weightKg);
  if (result.heightCm != null) result.heightCm = String(result.heightCm);
  return result as DrizzleRiderProfileUpdate;
}

interface RiderFilters {
  search?: string;
  skillLevel?: string;
  page: number;
  pageSize: number;
}

export async function getRidersByClub(clubId: string, filters: RiderFilters) {
  const conditions: SQL[] = [eq(riderProfiles.clubId, clubId)];

  if (filters.skillLevel) {
    conditions.push(sql`${riderProfiles.skillLevel} = ${filters.skillLevel}`);
  }

  if (filters.search) {
    conditions.push(ilike(clubMembers.displayName, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  // Belt-and-braces tenant scope on the join. `rider_profiles.club_id` is
  // already filtered by `where`, but the FK on `member_id -> club_members.id`
  // is single-column — it does not enforce that the joined membership row
  // belongs to the same club. Migration 0019 closes this at the schema
  // level via a composite FK; binding the join here is defence in depth.
  const memberJoin = and(
    eq(riderProfiles.memberId, clubMembers.id),
    eq(clubMembers.clubId, clubId),
  );

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
      .innerJoin(clubMembers, memberJoin)
      .where(where)
      .orderBy(asc(clubMembers.displayName))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(riderProfiles)
      .innerJoin(clubMembers, memberJoin)
      .where(where),
  ]);

  return {
    // Audit MED-3 + pass-2 B-1: decrypt PHI fields per row.
    data: data.map((row) => decryptFields(row, RIDER_PROFILE_ENCRYPTED_FIELDS)),
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
    .innerJoin(
      clubMembers,
      and(eq(riderProfiles.memberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .where(and(eq(riderProfiles.id, riderId), eq(riderProfiles.clubId, clubId)))
    .limit(1);

  const row = result[0];
  if (!row) return null;
  // Audit MED-3 + pass-2 B-1: decrypt PHI fields. `decryptFields`
  // returns plaintext for `v1:`-prefixed values, or pass-through for
  // rows the backfill hasn't reached yet — the verifier migration
  // `0053_audit_pass_2_phi_verifier.sql` will abort the next deploy
  // if any unbackfilled rows remain.
  return decryptFields(row, RIDER_PROFILE_ENCRYPTED_FIELDS);
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
      emergencyContactName: riderProfiles.emergencyContactName,
      emergencyContactPhone: riderProfiles.emergencyContactPhone,
      emergencyContactRelation: riderProfiles.emergencyContactRelation,
      // Audit r5 F-36 (2026-05-07): rider self-service GET should
      // expose plaintext medical notes to the rider themselves so
      // writes (PATCH /me/profile) and reads stay symmetric. Admins
      // already see this via /riders/[riderId]/route.ts.
      medicalNotes: riderProfiles.medicalNotes,
      totalLessonsCompleted: riderProfiles.totalLessonsCompleted,
      parentMemberId: riderProfiles.parentMemberId,
      displayName: clubMembers.displayName,
    })
    .from(riderProfiles)
    .innerJoin(
      clubMembers,
      and(eq(riderProfiles.memberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .where(and(eq(riderProfiles.memberId, memberId), eq(riderProfiles.clubId, clubId)))
    .limit(1);

  const row = result[0];
  if (!row) return null;
  return decryptFields(row, RIDER_PROFILE_ENCRYPTED_FIELDS);
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
 * they sign up.
 */
export async function createRider(clubId: string, data: CreateRiderData) {
  return writeTransaction(async (tx) => {
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

    // Audit MED-3 + pass-2 B-1: encrypt every PHI/PII field listed in
    // `RIDER_PROFILE_ENCRYPTED_FIELDS`. `encryptFields` skips undefined
    // (so omitted fields don't get a `v1:` prefix written for an empty
    // value).
    //
    // Audit I8 (2026-05-18): the `encryptFields` bound was widened so
    // typed inputs no longer require an index-signature cast. The
    // object literal below carries the exact-key shape encryptFields
    // expects.
    const encryptedPhi = encryptFields(
      {
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        emergencyContactRelation: data.emergencyContactRelation,
        medicalNotes: data.medicalNotes,
      },
      RIDER_PROFILE_ENCRYPTED_FIELDS,
    );

    const [profile] = await tx
      .insert(riderProfiles)
      .values({
        clubId,
        memberId: member.id,
        dateOfBirth: data.dateOfBirth,
        weightKg: data.weightKg != null ? String(data.weightKg) : null,
        heightCm: data.heightCm != null ? String(data.heightCm) : null,
        skillLevel: data.skillLevel as 'beginner' | 'intermediate' | 'advanced',
        ...encryptedPhi,
      })
      .returning();

    return { member, profile };
  });
}

export async function updateRiderProfile(
  clubId: string,
  riderId: string,
  data: RiderProfileUpdate,
) {
  // Audit MED-3 + pass-2 B-1: encrypt every PHI/PII field on PATCH.
  // PATCH semantics: omitted ≠ null (omitted = leave alone, null =
  // clear). `encryptFields` only writes keys present in `data`, so
  // undefined fields stay omitted from the UPDATE SET — preserving
  // existing values.
  //
  // Audit I8 (2026-05-18): the previous double-`unknown` cast threading
  // `data` through `Record<string, unknown>` was removed when
  // `encryptFields` was generalized to accept any T (see
  // packages/db/src/crypto.ts).
  const partial = toRiderDecimalStrings(data);
  const encryptedPhi = encryptFields(data, RIDER_PROFILE_ENCRYPTED_FIELDS);
  const values = {
    ...partial,
    ...encryptedPhi,
    updatedAt: new Date(),
  } as Partial<NewRiderProfile>;
  const result = await db
    .update(riderProfiles)
    .set(values)
    .where(and(eq(riderProfiles.id, riderId), eq(riderProfiles.clubId, clubId)))
    .returning();

  const row = result[0];
  if (!row) return null;
  // Audit r5 F-36 (2026-05-07): decrypt before returning so PATCH
  // responses stay symmetric with GET. Without this the route returns
  // ciphertext on PATCH; if the client persists it and PATCHes it back,
  // the server re-encrypts the already-encrypted value → silent data
  // corruption.
  return decryptFields(row, RIDER_PROFILE_ENCRYPTED_FIELDS);
}

/**
 * Upsert a rider_profiles row keyed by (clubId, memberId). Used by the
 * rider-facing /rider/profile page so riders who joined via /discover can
 * fill in their own details without needing an admin to create the row
 * first.
 *
 * Implemented as a single atomic INSERT ... ON CONFLICT DO UPDATE keyed
 * on the `rider_profiles_club_member_unique` index. The previous
 * SELECT-then-INSERT path raced under concurrent first-time saves
 * (two requests both saw `existing = []` and both inserted, leaving
 * the rider with two profile rows). The ON CONFLICT path serializes
 * at the index, so the second writer falls through to UPDATE.
 *
 * `totalLessonsCompleted` is intentionally never written here — it's
 * owned by the bookings completion flow.
 */
export async function upsertRiderProfileByMember(
  clubId: string,
  memberId: string,
  data: RiderProfileUpdate,
) {
  const weightKg = data.weightKg != null ? String(data.weightKg) : null;
  const heightCm = data.heightCm != null ? String(data.heightCm) : null;

  // Audit MED-3 + pass-2 B-1: encrypt every PHI/PII field. INSERT path
  // uses null when the caller omitted the field (first-write); UPDATE
  // path uses `encryptFields(data, …)` which preserves PATCH semantics
  // (omitted = leave alone).
  //
  // Audit I8 (2026-05-18): `Record<string, unknown>` casts removed —
  // `encryptFields` was generalized to accept any T.
  const insertEncryptedPhi = encryptFields(
    {
      emergencyContactName: data.emergencyContactName ?? null,
      emergencyContactPhone: data.emergencyContactPhone ?? null,
      emergencyContactRelation: data.emergencyContactRelation ?? null,
      medicalNotes: data.medicalNotes ?? null,
    },
    RIDER_PROFILE_ENCRYPTED_FIELDS,
  );
  const updateEncryptedPhi = encryptFields(data, RIDER_PROFILE_ENCRYPTED_FIELDS);

  // For the UPDATE half, only set fields the caller actually supplied.
  // PATCH semantics: omitted ≠ null. Omitted leaves the existing column
  // alone; `null` would explicitly clear it.
  const updateValues: Partial<NewRiderProfile> = {
    updatedAt: new Date(),
    ...(data.skillLevel !== undefined
      ? { skillLevel: data.skillLevel as 'beginner' | 'intermediate' | 'advanced' }
      : {}),
    ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
    ...(data.weightKg !== undefined ? { weightKg } : {}),
    ...(data.heightCm !== undefined ? { heightCm } : {}),
    ...updateEncryptedPhi,
  };

  const result = await db
    .insert(riderProfiles)
    .values({
      clubId,
      memberId,
      skillLevel:
        (data.skillLevel as 'beginner' | 'intermediate' | 'advanced' | undefined) ?? 'beginner',
      dateOfBirth: data.dateOfBirth ?? null,
      weightKg,
      heightCm,
      ...insertEncryptedPhi,
    })
    .onConflictDoUpdate({
      target: [riderProfiles.clubId, riderProfiles.memberId],
      set: updateValues,
    })
    .returning();
  const row = result[0];
  if (!row) return null;
  // Audit r5 F-36 (2026-05-07): decrypt before returning — see
  // updateRiderProfile for the data-corruption hazard otherwise.
  return decryptFields(row, RIDER_PROFILE_ENCRYPTED_FIELDS);
}

/**
 * Returns true if `parentMemberId` is recorded as the guardian of the rider
 * profile attached to `childMemberId`, scoped to `clubId`. Used by the
 * booking and payment routes to authorize parents acting on behalf of a
 * child rider — without this check, a `parent` role could pass any
 * rider's memberId as `riderMemberId` and book/pay on their behalf.
 *
 * Returns false when the child has no rider profile (e.g. a coach or
 * groom whose memberId was supplied), or when `parentMemberId === childMemberId`
 * (a member is never their own parent).
 */
export async function isParentOf(
  clubId: string,
  parentMemberId: string,
  childMemberId: string,
): Promise<boolean> {
  if (parentMemberId === childMemberId) return false;
  const result = await db
    .select({ parentMemberId: riderProfiles.parentMemberId })
    .from(riderProfiles)
    .where(and(eq(riderProfiles.clubId, clubId), eq(riderProfiles.memberId, childMemberId)))
    .limit(1);
  return result[0]?.parentMemberId === parentMemberId;
}

/**
 * Returns the memberIds of every ACTIVE rider whose `parent_member_id` points
 * at the given parent, scoped to `clubId`. Used by the booking GET path to
 * list a parent's children's bookings without forcing them to know each
 * child's id.
 *
 * Audit 2026-05-13 (P1): joined `club_members` and filtered
 * `clubMembers.isActive = true`. Without this filter, a parent could see (and
 * via downstream write paths potentially book/cancel for) a child who had
 * been deactivated by club staff — bypassing the deactivation signal entirely.
 * Mirrors the active-member gate used by `getMemberById` in
 * `packages/db/src/queries/club-members.ts`.
 */
export async function getDependentMemberIds(
  clubId: string,
  parentMemberId: string,
): Promise<string[]> {
  const result = await db
    .select({ memberId: riderProfiles.memberId })
    .from(riderProfiles)
    .innerJoin(
      clubMembers,
      and(eq(clubMembers.id, riderProfiles.memberId), eq(clubMembers.clubId, clubId)),
    )
    .where(
      and(
        eq(riderProfiles.clubId, clubId),
        eq(riderProfiles.parentMemberId, parentMemberId),
        eq(clubMembers.isActive, true),
      ),
    );
  return result.map((r) => r.memberId);
}
