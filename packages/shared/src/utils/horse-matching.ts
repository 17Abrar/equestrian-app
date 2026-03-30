import {
  SKILL_MATCH_EXACT_SCORE,
  SKILL_MATCH_CLOSE_SCORE,
  SKILL_MATCH_BAD_SCORE,
  WEIGHT_COMFORT_HIGH_SCORE,
  WEIGHT_COMFORT_MED_SCORE,
  WEIGHT_COMFORT_LOW_SCORE,
  WORKLOAD_FRESH_SCORE,
  WORKLOAD_BUSY_SCORE,
  TEMPERAMENT_MATCH_SCORE,
  PAST_PAIRING_GREAT_SCORE,
  PAST_PAIRING_OK_SCORE,
  PAST_PAIRING_BAD_SCORE,
  BASE_SCORE,
  MIN_SCORE,
  MAX_SCORE,
  TOP_MATCHES_COUNT,
  WEIGHT_COMFORT_MARGIN_HIGH,
  WEIGHT_COMFORT_MARGIN_MED,
  WEIGHT_COMFORT_MARGIN_LOW,
  WORKLOAD_BUSY_THRESHOLD,
} from '../constants/matching';

type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface MatchRider {
  id: string;
  skillLevel: SkillLevel;
  weight: number;
  height: number;
  age: number;
}

export interface MatchHorse {
  id: string;
  name: string;
  status: string;
  skillLevel: SkillLevel;
  weightLimit: number;
  minRiderAge: number;
  maxLessonsPerDay: number;
  lessonsToday: number;
  temperament: string[];
  bookedSlots: string[];
  pairingHistory: Array<{
    riderId: string;
    rating: number;
  }>;
}

export interface MatchResult {
  horse: MatchHorse;
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface MatchInput {
  rider: MatchRider;
  lessonType: string;
  dateTime: string;
  availableHorses: MatchHorse[];
}

export function matchHorsesToRider(input: MatchInput): MatchResult[] {
  const { rider, lessonType, dateTime, availableHorses } = input;

  // Filter out ineligible horses
  const eligible = availableHorses.filter((horse) => {
    if (horse.status !== 'available') return false;
    if (horse.bookedSlots.includes(dateTime)) return false;
    if (horse.lessonsToday >= horse.maxLessonsPerDay) return false;
    // weightLimit 0 means no limit configured — don't filter
    if (horse.weightLimit > 0 && rider.weight > horse.weightLimit) return false;
    if (horse.minRiderAge > 0 && rider.age < horse.minRiderAge) return false;
    return true;
  });

  // Score each eligible horse
  const scored = eligible.map((horse) => {
    let score = BASE_SCORE;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // Skill level match (most important: +/- 30 points)
    score += scoreSkillMatch(horse.skillLevel, rider.skillLevel, reasons, warnings);

    // Weight comfort margin (+/- 15 points)
    score += scoreWeightComfort(horse.weightLimit, rider.weight, reasons, warnings);

    // Workload today (+/- 10 points)
    score += scoreWorkload(horse.lessonsToday, horse.maxLessonsPerDay, reasons, warnings);

    // Temperament match for lesson type (+/- 10 points)
    score += scoreTemperament(horse.temperament, lessonType, reasons);

    // Past pairing success (+/- 15 points)
    score += scorePastPairings(horse.pairingHistory, rider.id, horse.name, reasons, warnings);

    // Clamp score
    score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));

    return { horse, score, reasons, warnings };
  });

  // Sort by score descending and return top matches
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_MATCHES_COUNT);
}

function scoreSkillMatch(
  horseSkill: SkillLevel,
  riderSkill: SkillLevel,
  reasons: string[],
  warnings: string[],
): number {
  if (horseSkill === riderSkill) {
    reasons.push(`Skill level match: ${horseSkill}`);
    return SKILL_MATCH_EXACT_SCORE;
  }

  const levels: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];
  const horseLevelIdx = levels.indexOf(horseSkill);
  const riderLevelIdx = levels.indexOf(riderSkill);

  // Horse one level below rider — good for progression
  if (horseLevelIdx === riderLevelIdx - 1) {
    reasons.push('Suitable for rider progression');
    return SKILL_MATCH_CLOSE_SCORE;
  }

  // Horse is advanced but rider is beginner — dangerous
  if (horseSkill === 'advanced' && riderSkill === 'beginner') {
    warnings.push('Horse may be too advanced for this rider');
    return SKILL_MATCH_BAD_SCORE;
  }

  return 0;
}

function scoreWeightComfort(
  weightLimit: number,
  riderWeight: number,
  reasons: string[],
  warnings: string[],
): number {
  // No weight limit configured — no score adjustment
  if (weightLimit <= 0) return 0;

  const margin = weightLimit - riderWeight;

  if (margin > WEIGHT_COMFORT_MARGIN_HIGH) {
    reasons.push('Comfortable weight margin');
    return WEIGHT_COMFORT_HIGH_SCORE;
  }

  if (margin > WEIGHT_COMFORT_MARGIN_MED) {
    return WEIGHT_COMFORT_MED_SCORE;
  }

  if (margin <= WEIGHT_COMFORT_MARGIN_LOW) {
    warnings.push('Rider weight is close to horse limit');
    return WEIGHT_COMFORT_LOW_SCORE;
  }

  return 0;
}

function scoreWorkload(
  lessonsToday: number,
  maxLessons: number,
  reasons: string[],
  warnings: string[],
): number {
  if (lessonsToday === 0) {
    reasons.push('Horse is fresh today');
    return WORKLOAD_FRESH_SCORE;
  }

  const ratio = lessonsToday / maxLessons;
  if (ratio > WORKLOAD_BUSY_THRESHOLD) {
    warnings.push('Horse has had a busy day');
    return WORKLOAD_BUSY_SCORE;
  }

  return 0;
}

function scoreTemperament(
  temperament: string[],
  lessonType: string,
  reasons: string[],
): number {
  if (lessonType === 'group' && temperament.includes('calm')) {
    reasons.push('Calm temperament, great for group lessons');
    return TEMPERAMENT_MATCH_SCORE;
  }

  if (
    (lessonType === 'desert_ride' || lessonType === 'beach_ride') &&
    temperament.includes('bombproof')
  ) {
    reasons.push('Bombproof temperament, ideal for outdoor rides');
    return TEMPERAMENT_MATCH_SCORE;
  }

  return 0;
}

function scorePastPairings(
  pairingHistory: Array<{ riderId: string; rating: number }>,
  riderId: string,
  horseName: string,
  reasons: string[],
  warnings: string[],
): number {
  const pastPairings = pairingHistory.filter((p) => p.riderId === riderId);

  if (pastPairings.length === 0) return 0;

  const avgRating = pastPairings.reduce((sum, p) => sum + p.rating, 0) / pastPairings.length;

  if (avgRating >= 4) {
    reasons.push(`Rider has ridden ${horseName} before with great results`);
    return PAST_PAIRING_GREAT_SCORE;
  }

  if (avgRating >= 3) {
    reasons.push(`Rider has ridden ${horseName} before`);
    return PAST_PAIRING_OK_SCORE;
  }

  if (avgRating < 2) {
    warnings.push('Previous pairing had issues');
    return PAST_PAIRING_BAD_SCORE;
  }

  return 0;
}
