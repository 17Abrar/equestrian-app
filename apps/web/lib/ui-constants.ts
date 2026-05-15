export const HORSE_STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  resting: 'bg-yellow-100 text-yellow-800',
  injured: 'bg-red-100 text-red-800',
  retired: 'bg-gray-100 text-gray-800',
  off_site: 'bg-blue-100 text-blue-800',
  sold: 'bg-purple-100 text-purple-800',
};

export const SKILL_LEVEL_COLORS: Record<string, string> = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-blue-100 text-blue-800',
  advanced: 'bg-purple-100 text-purple-800',
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-gray-100 text-gray-800',
};

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  refunded: 'bg-purple-100 text-purple-800',
};

export const COMPETITION_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  published: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export const COMPETITION_ENTRY_STATUS_COLORS: Record<string, string> = {
  registered: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  withdrawn: 'bg-gray-100 text-gray-800',
  scratched: 'bg-red-100 text-red-800',
};

export const LESSON_TYPE_COLORS: Record<string, string> = {
  group: '#3b82f6',
  semi_private: '#8b5cf6',
  private: '#f59e0b',
  desert_ride: '#f97316',
  beach_ride: '#06b6d4',
  endurance: '#ef4444',
  camp: '#10b981',
  clinic: '#ec4899',
  custom: '#6366f1',
};

/**
 * Audit 2026-05-13 (P1): single source of truth for "what day starts the
 * week" across the dashboard. Calendar (month/week/agenda views) and the
 * bookings list day-strip previously disagreed — calendar started weeks on
 * Sunday (`weekStartsOn: 0`), the bookings day-strip started on Monday.
 * Both surfaces now consume this constant so a future per-club preference
 * (`clubs.weekStartsOn`) only has to change one place.
 *
 * 0 = Sunday, 1 = Monday, 6 = Saturday. GCC clubs traditionally consider
 * Saturday the start of the working week; we keep 0 (Sunday) for now to
 * match the cultural week-start visible in most local calendars (Sunday
 * column drawn first), and document the override path inline.
 */
// `as 0 | 1 | 6` widens the literal so the WEEKDAY_LABELS_* ternaries
// below aren't flagged as unreachable comparisons against the
// not-currently-selected branches.
export const WEEK_STARTS_ON = 0 as 0 | 1 | 6;

/**
 * Short two-letter weekday labels in WEEK_STARTS_ON order. Index 0 in this
 * array is whichever day WEEK_STARTS_ON identifies as the start.
 */
export const WEEKDAY_LABELS_SHORT: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] =
  WEEK_STARTS_ON === 1
    ? (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)
    : WEEK_STARTS_ON === 6
      ? (['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const)
      : (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const);

export const WEEKDAY_LABELS_LETTER: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] =
  WEEK_STARTS_ON === 1
    ? (['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const)
    : WEEK_STARTS_ON === 6
      ? (['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'] as const)
      : (['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const);
