import { pgTable, uuid, date, numeric, text, integer, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { skillLevelEnum } from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';

export const riderProfiles = pgTable(
  'rider_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // FK is composite (member_id, club_id) -> club_members(id, club_id),
    // declared below. Replaces the pre-0019 single-column FK so the DB
    // rejects mismatched-tenant inserts.
    memberId: uuid('member_id').notNull(),
    dateOfBirth: date('date_of_birth'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    skillLevel: skillLevelEnum('skill_level').notNull().default('beginner'),
    // Audit pass-2 (2026-05-09): widened from varchar to text to fit
    // the AES-256-GCM `encryptField` envelope (`v1:` + base64). All
    // three columns are now encrypted-at-rest; reads decrypt in
    // `riders.ts`. Migration 0052 widens the columns; the verifier
    // 0053 + `scripts/backfill-pass-2-phi.mjs` cover existing rows.
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    emergencyContactRelation: text('emergency_contact_relation'),
    medicalNotes: text('medical_notes'),
    totalLessonsCompleted: integer('total_lessons_completed').notNull().default(0),
    // ON DELETE SET NULL (audit H-7). Without this, deleting a parent member
    // is FK-blocked by their child's profile. A child's profile survives the
    // parent leaving the club; the field becomes informational.
    //
    // Audit F-6 (2026-05-06 r2): inline single-column FK dropped in
    // migration 0041; replaced with composite (parent_member_id, club_id)
    // → club_members(id, club_id) ON DELETE SET NULL declared in
    // table-extras below — closes the cross-tenant smuggle surface.
    parentMemberId: uuid('parent_member_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // (club_id, member_id) is logically unique — one profile per
    // membership. Backed by migration 0016 and required by the
    // INSERT ... ON CONFLICT path in upsertRiderProfileByMember.
    uniqueIndex('rider_profiles_club_member_unique').on(table.clubId, table.memberId),
    index('idx_rider_profiles_club').on(table.clubId),
    index('idx_rider_profiles_member').on(table.memberId),
    index('idx_rider_profiles_skill').on(table.clubId, table.skillLevel),
    // Audit F-42 (2026-05-07 r5): the CASCADE here is a fallback only
    // — `bookings.rider_member_club_fk` is NO ACTION (audit rule for
    // financial member_id columns), so any attempt to DELETE a club
    // member with prior bookings is rejected at the bookings constraint
    // before this rider_profiles row is ever cascaded. The CASCADE
    // exists so a future hard-delete admin tool that ALSO purges the
    // member's bookings (or anonymises them via member_id rewrite)
    // doesn't have to remember to clean rider_profiles separately.
    // For voluntary "leave the club" flows we set
    // `club_members.is_active = false` and never delete the row, so
    // this constraint is unreachable in production today.
    foreignKey({
      name: 'rider_profiles_member_club_fk',
      columns: [table.memberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'rider_profiles_parent_member_club_fk',
      columns: [table.parentMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }).onDelete('set null'),
  ],
);
