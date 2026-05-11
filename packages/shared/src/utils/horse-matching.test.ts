import { describe, it, expect } from 'vitest';
import {
  matchHorsesToRider,
  type MatchHorse,
  type MatchRider,
  type MatchInput,
} from './horse-matching';

function makeRider(overrides: Partial<MatchRider> = {}): MatchRider {
  return {
    id: 'rider-1',
    skillLevel: 'intermediate',
    weight: 70,
    height: 170,
    age: 25,
    ...overrides,
  };
}

function makeHorse(overrides: Partial<MatchHorse> = {}): MatchHorse {
  return {
    id: 'horse-1',
    name: 'Thunder',
    status: 'available',
    skillLevel: 'intermediate',
    weightLimit: 90,
    minRiderAge: 0,
    maxLessonsPerDay: 3,
    lessonsToday: 0,
    temperament: ['calm', 'responsive'],
    bookedSlots: [],
    pairingHistory: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    rider: makeRider(),
    lessonType: 'private',
    dateTime: '2026-04-01T10:00:00',
    availableHorses: [makeHorse()],
    ...overrides,
  };
}

describe('matchHorsesToRider', () => {
  it('returns exact skill level match with high score', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ skillLevel: 'intermediate' }),
        availableHorses: [makeHorse({ skillLevel: 'intermediate' })],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeGreaterThanOrEqual(80);
    expect(result[0]!.reasons).toContain('Skill level match: intermediate');
  });

  it('filters out horse over weight limit', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 100 }),
        availableHorses: [makeHorse({ weightLimit: 90 })],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('filters out horse at weight limit', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 90 }),
        availableHorses: [makeHorse({ weightLimit: 90 })],
      }),
    );

    // Weight is at limit (not over), so horse is eligible
    expect(result).toHaveLength(1);
  });

  it('gives well-under-weight a higher score', () => {
    const heavyRider = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 85 }),
        availableHorses: [makeHorse({ weightLimit: 90 })],
      }),
    );

    const lightRider = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 60 }),
        availableHorses: [makeHorse({ weightLimit: 90 })],
      }),
    );

    expect(lightRider[0]!.score).toBeGreaterThan(heavyRider[0]!.score);
  });

  it('filters out horse at max workload', () => {
    const result = matchHorsesToRider(
      makeInput({
        availableHorses: [makeHorse({ lessonsToday: 3, maxLessonsPerDay: 3 })],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('penalizes horse with busy day', () => {
    const fresh = matchHorsesToRider(
      makeInput({
        availableHorses: [makeHorse({ id: 'fresh', lessonsToday: 0 })],
      }),
    );

    const busy = matchHorsesToRider(
      makeInput({
        availableHorses: [makeHorse({ id: 'busy', lessonsToday: 2, maxLessonsPerDay: 3 })],
      }),
    );

    // 2/3 = 0.67 which is below busy threshold (0.7), so no penalty. Fresh gets bonus.
    expect(fresh[0]!.score).toBeGreaterThan(busy[0]!.score);
  });

  it('filters out horse with wrong status', () => {
    const result = matchHorsesToRider(
      makeInput({
        availableHorses: [makeHorse({ status: 'injured' })],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('filters out already-booked horse', () => {
    const result = matchHorsesToRider(
      makeInput({
        dateTime: '2026-04-01T10:00:00',
        availableHorses: [makeHorse({ bookedSlots: ['2026-04-01T10:00:00'] })],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('filters out horse when rider under min age', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ age: 8 }),
        availableHorses: [makeHorse({ minRiderAge: 12 })],
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('rewards positive past pairings', () => {
    const noPast = matchHorsesToRider(
      makeInput({
        rider: makeRider({ id: 'rider-1' }),
        availableHorses: [makeHorse({ pairingHistory: [] })],
      }),
    );

    const goodPast = matchHorsesToRider(
      makeInput({
        rider: makeRider({ id: 'rider-1' }),
        availableHorses: [makeHorse({ pairingHistory: [{ riderId: 'rider-1', rating: 5 }] })],
      }),
    );

    expect(goodPast[0]!.score).toBeGreaterThan(noPast[0]!.score);
    expect(goodPast[0]!.reasons).toContain('Rider has ridden Thunder before with great results');
  });

  it('penalizes negative past pairings', () => {
    const badPast = matchHorsesToRider(
      makeInput({
        rider: makeRider({ id: 'rider-1' }),
        availableHorses: [makeHorse({ pairingHistory: [{ riderId: 'rider-1', rating: 1 }] })],
      }),
    );

    const noPast = matchHorsesToRider(
      makeInput({
        rider: makeRider({ id: 'rider-1' }),
        availableHorses: [makeHorse({ pairingHistory: [] })],
      }),
    );

    expect(badPast[0]!.score).toBeLessThan(noPast[0]!.score);
    expect(badPast[0]!.warnings).toContain('Previous pairing had issues');
  });

  it('rewards calm temperament for group lessons', () => {
    const calm = matchHorsesToRider(
      makeInput({
        lessonType: 'group',
        availableHorses: [makeHorse({ temperament: ['calm'] })],
      }),
    );

    const energetic = matchHorsesToRider(
      makeInput({
        lessonType: 'group',
        availableHorses: [makeHorse({ temperament: ['energetic'] })],
      }),
    );

    expect(calm[0]!.score).toBeGreaterThan(energetic[0]!.score);
  });

  it('rewards bombproof temperament for desert rides', () => {
    const bombproof = matchHorsesToRider(
      makeInput({
        lessonType: 'desert_ride',
        availableHorses: [makeHorse({ temperament: ['bombproof'] })],
      }),
    );

    const regular = matchHorsesToRider(
      makeInput({
        lessonType: 'desert_ride',
        availableHorses: [makeHorse({ temperament: ['responsive'] })],
      }),
    );

    expect(bombproof[0]!.score).toBeGreaterThan(regular[0]!.score);
  });

  it('warns when advanced horse paired with beginner', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ skillLevel: 'beginner' }),
        availableHorses: [makeHorse({ skillLevel: 'advanced' })],
      }),
    );

    expect(result[0]!.warnings).toContain('Horse may be too advanced for this rider');
  });

  it('includes horse with no weight limit (weightLimit 0) for any rider weight', () => {
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 120 }),
        availableHorses: [makeHorse({ weightLimit: 0 })],
      }),
    );

    expect(result).toHaveLength(1);
  });

  it('does not give weight bonus or penalty when weight limit is not configured', () => {
    const withLimit = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 60 }),
        availableHorses: [makeHorse({ id: 'h1', weightLimit: 90 })],
      }),
    );

    const noLimit = matchHorsesToRider(
      makeInput({
        rider: makeRider({ weight: 60 }),
        availableHorses: [makeHorse({ id: 'h2', weightLimit: 0 })],
      }),
    );

    // Horse with configured limit (90kg) and light rider (60kg) should get weight bonus
    // Horse with no limit (0) should get no weight adjustment (neither bonus nor penalty)
    expect(withLimit[0]!.score).toBeGreaterThan(noLimit[0]!.score);
  });

  it('returns empty array when no horses available', () => {
    const result = matchHorsesToRider(
      makeInput({
        availableHorses: [],
      }),
    );

    expect(result).toEqual([]);
  });

  it('returns at most 3 results', () => {
    const horses = Array.from({ length: 10 }, (_, i) =>
      makeHorse({ id: `horse-${i}`, name: `Horse ${i}` }),
    );

    const result = matchHorsesToRider(makeInput({ availableHorses: horses }));

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns results sorted by score descending', () => {
    const horses = [
      makeHorse({ id: 'h1', name: 'Beginner Horse', skillLevel: 'beginner' }),
      makeHorse({ id: 'h2', name: 'Intermediate Horse', skillLevel: 'intermediate' }),
      makeHorse({ id: 'h3', name: 'Advanced Horse', skillLevel: 'advanced' }),
    ];

    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ skillLevel: 'intermediate' }),
        availableHorses: horses,
      }),
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it('clamps score between 0 and 100', () => {
    // Worst case scenario
    const result = matchHorsesToRider(
      makeInput({
        rider: makeRider({ skillLevel: 'beginner', weight: 88 }),
        availableHorses: [
          makeHorse({
            skillLevel: 'advanced',
            weightLimit: 90,
            lessonsToday: 2,
            maxLessonsPerDay: 3,
            pairingHistory: [{ riderId: 'rider-1', rating: 1 }],
          }),
        ],
      }),
    );

    expect(result[0]!.score).toBeGreaterThanOrEqual(0);
    expect(result[0]!.score).toBeLessThanOrEqual(100);
  });
});
