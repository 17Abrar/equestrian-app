// Pagination
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

// File uploads
export const MAX_FILE_SIZE_IMAGE = 15 * 1024 * 1024; // 15MB
export const MAX_FILE_SIZE_DOCUMENT = 25 * 1024 * 1024; // 25MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const ALLOWED_FILE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'doc',
  'docx',
] as const;

// Booking defaults
export const DEFAULT_ADVANCE_BOOKING_DAYS = 30;
export const DEFAULT_BOOKING_CUTOFF_HOURS = 2;
export const DEFAULT_CANCELLATION_NOTICE_HOURS = 24;
export const DEFAULT_LESSON_DURATION_MINUTES = 60;

// Horse workload
export const DEFAULT_MAX_LESSONS_PER_DAY = 3;
export const DEFAULT_MANDATORY_REST_DAYS = 1;

// Waitlist
export const WAITLIST_ACCEPTANCE_WINDOW_MINUTES = 15;

// Toast durations (ms)
export const TOAST_DURATION_SUCCESS = 5000;
export const TOAST_DURATION_ERROR = Infinity;
export const TOAST_DURATION_WARNING = 8000;
export const TOAST_DURATION_INFO = 5000;

// TanStack Query cache times (ms)
export const STALE_TIME_FREQUENT = 30 * 1000; // 30 seconds for frequently-changing data
export const STALE_TIME_MEDIUM = 60 * 1000; // 1 minute for moderately-stable lists
export const STALE_TIME_STABLE = 5 * 60 * 1000; // 5 minutes for stable data
export const STALE_TIME_BURST = 10 * 1000; // 10 seconds — audience preview / live counters

// Livery billing — sanity cap on monthly fee. Stored in minor units (fils
// for 2-decimal AED). 10M fils = 100,000 AED ≈ 27,000 USD per month. Real
// fees top out an order of magnitude below this; the cap exists to catch
// admin-form typos like 50000 → 5000000 (a missed comma) before the cron
// issues an absurd invoice. For 3-decimal currencies (KWD/BHD/etc.) the
// same cap covers ~10,000 KWD which is also generous.
export const MAX_MONTHLY_LIVERY_FEE_MINOR = 10_000_000;

// Time arithmetic — shared across server + client so a 30-day cookie TTL
// or a "year-in-ms" math expression doesn't drift between callsites.
// Audit F-12.
export const MS_PER_DAY = 86_400_000;
export const MS_PER_YEAR_AVG = 365.25 * MS_PER_DAY;
export const ACTIVE_CLUB_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;

// Rate-limit presets. Per-route configs reach for one of these instead of
// open-coding `{ maxRequests, windowMs }` object literals — see audit F-15.
// `failClosed: true` is route-specific (coupon validate, public join), so
// callers spread + override that field.
export const RATE_LIMIT_TIGHT = { maxRequests: 10, windowMs: 60_000 } as const;
export const RATE_LIMIT_STANDARD = { maxRequests: 60, windowMs: 60_000 } as const;
export const RATE_LIMIT_PUBLIC_BURST = { maxRequests: 20, windowMs: 60_000 } as const;
export const RATE_LIMIT_HEALTHCHECK = { maxRequests: 120, windowMs: 60_000 } as const;
