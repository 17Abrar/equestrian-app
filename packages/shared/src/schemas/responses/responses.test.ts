import { describe, expect, it } from 'vitest';
import { horseListItemSchema } from './horses';
import { bookingListItemSchema } from './bookings';

/**
 * Audit F-69 companion (2026-05-08 r6): the response schemas in this
 * folder are the runtime gate the api-client uses on every refetch.
 * The tests here are the regression suite that catches "I shipped a
 * server-side projection change without updating the schema" — a
 * dropped enum literal, a renamed column, an int-to-string drift —
 * before that change reaches a real device.
 */

describe('horseListItemSchema (F-69 companion)', () => {
  const validRow = {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: '22222222-2222-4222-8222-222222222222',
    name: 'Spirit',
    primaryPhotoUrl: null,
    breed: 'Arabian',
    gender: 'mare',
    color: 'bay',
    heightHands: '15.2',
    weightKg: null,
    status: 'available',
    skillLevel: 'beginner',
    weightLimitKg: '85',
    notes: null,
    ownerMemberId: null,
    ownershipStatus: 'active',
    ownershipSubmittedAt: null,
    ownerName: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
  };

  it('accepts a row that matches the server projection', () => {
    expect(horseListItemSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects a row missing the status enum', () => {
    const { status: _status, ...rest } = validRow;
    expect(horseListItemSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a row whose status drifts to an unknown literal', () => {
    expect(horseListItemSchema.safeParse({ ...validRow, status: 'pasture' }).success).toBe(false);
  });

  it('rejects a row whose ownerMemberId is a non-UUID string', () => {
    expect(
      horseListItemSchema.safeParse({ ...validRow, ownerMemberId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('passes through unknown columns the server adds later', () => {
    const parsed = horseListItemSchema.safeParse({
      ...validRow,
      newServerColumn: 'value',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Audit 2026-05-13 (P1): use a typed intersection instead of the
      // `Record<string, unknown>` cast. Avoids setting the
      // "cast-to-Record" precedent for future tests.
      const dataWithExtra = parsed.data as typeof validRow & { newServerColumn: string };
      expect(dataWithExtra.newServerColumn).toBe('value');
    }
  });
});

describe('bookingListItemSchema (F-69 companion)', () => {
  const validRow = {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: '22222222-2222-4222-8222-222222222222',
    slotId: '33333333-3333-4333-8333-333333333333',
    riderMemberId: '44444444-4444-4444-8444-444444444444',
    horseId: null,
    status: 'confirmed',
    paymentStatus: 'paid',
    amount: 12000,
    currency: 'AED',
    createdAt: '2026-05-01T00:00:00Z',
    slotDate: '2026-05-08',
    slotStartTime: '09:00:00',
    slotEndTime: '10:00:00',
    lessonTypeName: 'Group lesson',
    lessonTypeType: 'group',
    arenaName: 'Main arena',
    riderName: 'Layla',
    horseName: null,
  };

  it('accepts a row that matches the server projection', () => {
    expect(bookingListItemSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects a row whose paymentStatus drifts to an unknown literal', () => {
    expect(bookingListItemSchema.safeParse({ ...validRow, paymentStatus: 'voided' }).success).toBe(
      false,
    );
  });

  it('rejects a row whose amount comes through as a string (Drizzle numeric pitfall)', () => {
    expect(bookingListItemSchema.safeParse({ ...validRow, amount: '12000' }).success).toBe(false);
  });

  it('accepts a row with null horseId / horseName (no horse assigned)', () => {
    expect(
      bookingListItemSchema.safeParse({ ...validRow, horseId: null, horseName: null }).success,
    ).toBe(true);
  });
});
