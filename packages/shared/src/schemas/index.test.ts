import { describe, it, expect } from 'vitest';
import {
  createHorseSchema,
  updateHorseSchema,
  transferHorseOwnerSchema,
  createBookingSchema,
} from './index';

describe('updateHorseSchema — mass-assignment guard', () => {
  // The single most important invariant on this schema: PATCH /horses/[id]
  // must NEVER let a caller sneak `ownerMemberId` in alongside vanilla
  // weight/gear changes. Ownership transfers go through the dedicated
  // endpoint, which validates the new owner is a club member and writes
  // an audit log. Weakening this schema would re-open the
  // 2026-04 audit's CRITICAL #2 finding. Audit G-5 added `.strict()`
  // so unknown keys now THROW rather than being silently stripped.
  it('rejects ownerMemberId alongside other fields', () => {
    expect(() =>
      updateHorseSchema.parse({
        name: 'Buttercup',
        weightKg: 480,
        ownerMemberId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toThrow();
  });

  it('rejects a body where ownerMemberId is the only field', () => {
    expect(() =>
      updateHorseSchema.parse({
        ownerMemberId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toThrow();
  });

  it('rejects unknown / mass-assignment keys (totalLessonsCompleted, clubId, …)', () => {
    expect(() =>
      updateHorseSchema.parse({
        name: 'Buttercup',
        clubId: '00000000-0000-0000-0000-000000000002',
      }),
    ).toThrow();
  });

  it('still accepts every other field that createHorseSchema accepts', () => {
    const sample = {
      name: 'Buttercup',
      breed: 'Arabian',
      status: 'available' as const,
      skillLevel: 'intermediate' as const,
    };
    const fromCreate = createHorseSchema.parse(sample);
    const fromUpdate = updateHorseSchema.parse(sample);
    expect(fromUpdate.name).toBe(fromCreate.name);
    expect(fromUpdate.breed).toBe(fromCreate.breed);
    expect(fromUpdate.status).toBe(fromCreate.status);
  });
});

describe('transferHorseOwnerSchema', () => {
  it('accepts a valid uuid', () => {
    const result = transferHorseOwnerSchema.parse({
      ownerMemberId: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.ownerMemberId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('accepts null (school horse / clear owner)', () => {
    const result = transferHorseOwnerSchema.parse({ ownerMemberId: null });
    expect(result.ownerMemberId).toBeNull();
  });

  it('rejects a missing field', () => {
    expect(() => transferHorseOwnerSchema.parse({})).toThrow();
  });

  it('rejects a non-uuid string', () => {
    expect(() =>
      transferHorseOwnerSchema.parse({ ownerMemberId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('createBookingSchema', () => {
  it('rejects a body without slotId', () => {
    expect(() =>
      createBookingSchema.parse({
        riderMemberId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toThrow();
  });

  it('rejects a body without riderMemberId', () => {
    expect(() =>
      createBookingSchema.parse({
        slotId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toThrow();
  });

  it('does not have a price/amount/grossAmount field — those are server-authoritative', () => {
    // If anyone re-adds a price input here, double-check whether the
    // server still derives the booking amount from the slot's lessonType.
    // Allowing client-supplied price is a CLAUDE.md known pitfall.
    const result = createBookingSchema.parse({
      slotId: '00000000-0000-0000-0000-000000000001',
      riderMemberId: '00000000-0000-0000-0000-000000000002',
    });
    expect(result).not.toHaveProperty('price');
    expect(result).not.toHaveProperty('amount');
    expect(result).not.toHaveProperty('grossAmount');
  });

  it('accepts a guest sub-object with all required fields', () => {
    const result = createBookingSchema.parse({
      slotId: '00000000-0000-0000-0000-000000000001',
      riderMemberId: '00000000-0000-0000-0000-000000000002',
      guest: {
        name: 'Lina Halabi',
        email: 'lina@example.com',
        phone: '+971501234567',
        skillLevel: 'beginner',
      },
    });
    expect(result.guest).toMatchObject({ name: 'Lina Halabi' });
  });

  it('rejects a guest with missing email', () => {
    expect(() =>
      createBookingSchema.parse({
        slotId: '00000000-0000-0000-0000-000000000001',
        riderMemberId: '00000000-0000-0000-0000-000000000002',
        guest: {
          name: 'Lina Halabi',
          phone: '+971501234567',
          skillLevel: 'beginner',
        },
      }),
    ).toThrow();
  });
});
