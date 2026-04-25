import { pgTable, uuid, date, numeric, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
    memberId: uuid('member_id')
      .notNull()
      .references(() => clubMembers.id, { onDelete: 'cascade' }),
    dateOfBirth: date('date_of_birth'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    skillLevel: skillLevelEnum('skill_level').notNull().default('beginner'),
    emergencyContactName: varchar('emergency_contact_name', { length: 255 }),
    emergencyContactPhone: varchar('emergency_contact_phone', { length: 50 }),
    emergencyContactRelation: varchar('emergency_contact_relation', { length: 100 }),
    medicalNotes: text('medical_notes'),
    totalLessonsCompleted: integer('total_lessons_completed').notNull().default(0),
    parentMemberId: uuid('parent_member_id').references(() => clubMembers.id),

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
  ],
);
