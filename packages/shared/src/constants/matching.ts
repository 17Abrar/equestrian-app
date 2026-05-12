// Smart Horse Matching Algorithm Scores
export const BASE_SCORE = 50;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;
export const TOP_MATCHES_COUNT = 3;

// Skill level match scores
export const SKILL_MATCH_EXACT_SCORE = 30;
export const SKILL_MATCH_CLOSE_SCORE = 15;
export const SKILL_MATCH_BAD_SCORE = -20;

// Weight comfort scores
export const WEIGHT_COMFORT_HIGH_SCORE = 15;
export const WEIGHT_COMFORT_MED_SCORE = 5;
export const WEIGHT_COMFORT_LOW_SCORE = -10;
export const WEIGHT_COMFORT_MARGIN_HIGH = 20; // kg
export const WEIGHT_COMFORT_MARGIN_MED = 10; // kg
export const WEIGHT_COMFORT_MARGIN_LOW = 5; // kg

// Workload scores
export const WORKLOAD_FRESH_SCORE = 10;
export const WORKLOAD_BUSY_SCORE = -10;
export const WORKLOAD_BUSY_THRESHOLD = 0.7;

// Temperament match
export const TEMPERAMENT_MATCH_SCORE = 10;

// Past pairing scores
export const PAST_PAIRING_GREAT_SCORE = 15;
export const PAST_PAIRING_OK_SCORE = 5;
export const PAST_PAIRING_BAD_SCORE = -15;
