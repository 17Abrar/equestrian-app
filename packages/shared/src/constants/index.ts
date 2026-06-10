// Audit 2026-05-13 (P1): canonical list of currency codes the platform
// supports. The Zod schemas that accept user-supplied currencies validate
// against this tuple (was: any 3-letter string) so a typo'd 'XYZ' stops
// at the API boundary instead of silently flowing into `formatMoney` /
// `toMinorUnits` and getting a 2-decimal fallback. The CURRENCY_LOCALE
// table in `utils/money.ts` is keyed by this same set; adding a currency
// here means adding it there too.
export const SUPPORTED_CURRENCIES = [
  'AED',
  'SAR',
  'KWD',
  'BHD',
  'QAR',
  'OMR',
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
] as const satisfies readonly string[];

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// Pagination
export const DEFAULT_PAGE_SIZE = 25;
// Audit QA-18 — capped at 50 (down from 100) so a single oversized page
// can't blow the Worker subrequest budget on a join-heavy list.
export const MAX_PAGE_SIZE = 50;

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
// Audit F-12 / F-27.
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_YEAR_AVG = 365.25 * MS_PER_DAY;
export const ACTIVE_CLUB_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;

// Trial length granted to a freshly-created club. The Clerk
// `organization.created` webhook stamps `clubs.trial_ends_at` to
// `now + TRIAL_DURATION_DAYS`. Pricing copy must reference this
// constant — the previous webhook hardcoded 30 days while marketing
// quoted 14, so a new club got a quietly different deal than the one
// it signed up for.
export const TRIAL_DURATION_DAYS = 14;

// ─── Round 6 — Cavaliq → club subscription pricing ───────────────────
//
// Per-tier monthly fee in MINOR currency units (fils for AED). The
// platform-billing cron snapshots the matching value onto each invoice's
// `amount_minor_units` at issue time, so a future price change applies
// to NEW periods only, never retroactively. The 'trial' tier never
// generates an invoice — clubs in trial pay nothing until trial_ends_at
// elapses and the cron picks them up.
export const PLATFORM_TIER_PRICES_MINOR: Record<
  'trial' | 'starter' | 'growing' | 'professional',
  number
> = {
  trial: 0,
  starter: 30_000, // AED 300
  growing: 80_000, // AED 800
  professional: 200_000, // AED 2000
} as const;

// Days from period start until the invoice is overdue. Mirrors livery's
// 7-day cadence — clubs get a week to pay before reminders kick in
// (reminder cadence itself is the next round of work).
export const PLATFORM_INVOICE_DUE_DAYS = 7;

// Audit r5 F-9 (2026-05-07): canonical list of column / field names that
// carry PHI (protected health information) anywhere in the codebase. Both
// the schema-side notification builder (`NOTIFICATION_FORBIDDEN_FIELDS`)
// and the structured logger's redaction denylist read from this list, so
// the encrypted-at-rest invariant on health/medication tables is matched
// 1:1 by the log redactor — a freshly-decrypted record spread into a
// `logger.info(...)` payload is scrubbed before reaching stdout / Sentry.
//
// New PHI columns belong here. Mirror them into the `HEALTH_ENCRYPTED_FIELDS`
// / `MEDICATION_ENCRYPTED_FIELDS` arrays in `packages/db/src/queries/horse-health.ts`
// when the column is new.
export const PHI_KEYS = [
  'description',
  'diagnosis',
  'treatment',
  'notes',
  'medicalNotes',
  'symptoms',
  'medications',
  'vetInstructions',
  // Audit pass-2 (2026-05-09 B-3, B-4, B-6): treating-provider name,
  // coach observations, and freeform horse markings/notes are all
  // encrypted at rest in the same envelope as the columns above. Add
  // the field names to the redaction list so a downstream log payload
  // (logger.info, audit-log changes JSONB) won't leak the freshly-
  // decrypted plaintext.
  'prescribedBy',
  'coachNotes',
  'markings',
] as const;

// PII keys — identity / contact / sensitive personal data that isn't
// strictly PHI but lands in the same redaction discipline. Audit log
// `changes` JSONB and the structured logger both read from this list.
//
// Audit pass-2 (2026-05-09 B-1): emergencyContact* are now encrypted
// at rest (`packages/db/src/queries/riders.ts`) too — keeping them
// here means freshly-decrypted plaintext spread into a log call still
// gets scrubbed before reaching stdout / Sentry.
export const PII_KEYS = [
  'dateOfBirth',
  'displayName',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'guestEmail',
  'guestPhone',
  'guestName',
] as const;
