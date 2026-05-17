import { z } from 'zod';
import {
  MAX_MONTHLY_LIVERY_FEE_MINOR,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SUPPORTED_CURRENCIES,
} from '../constants';
import { PAYMENT_METHOD_VALUES } from '../types';

// Audit 2026-05-13 (P1): canonical currency field used by every inbound
// schema. Validating against SUPPORTED_CURRENCIES (vs raw `length(3)`)
// rejects typos like 'XYZ' at the API boundary instead of silently
// falling back to 2-decimal formatting downstream.
const currencyField = z.enum(SUPPORTED_CURRENCIES);

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Preprocessor for numeric form fields. Empty strings and null/undefined
 * become `undefined` (not 0). Valid numbers pass through for z.number() validation.
 * Solves the z.coerce.number() problem where "" becomes 0.
 */
function numericField(schema: z.ZodNumber) {
  return z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined;
    const num = Number(val);
    return Number.isNaN(num) ? val : num;
  }, schema);
}

function optionalNumeric(schema: z.ZodNumber = z.number()) {
  return numericField(schema).optional();
}

// URL fields where the form treats `''` as "not set". Without `.or(z.literal(''))`
// the empty string from a cleared input fails `.url()` validation and the form
// surfaces a misleading "invalid url" error.
//   `optionalUrl`         — undefined | '' | https?://…
//   `nullableOptionalUrl` — undefined | null | '' | https?://…   (used when
//                           the underlying column is nullable so admins can
//                           explicitly clear the value, not just leave it
//                           unchanged)
const optionalUrl = z.union([z.string().url().max(2000), z.literal('')]).optional();
const nullableOptionalUrl = z
  .union([z.string().url().max(2000), z.literal('')])
  .nullable()
  .optional();

// Audit F-38 (2026-05-07 r5): a datetime-local input emits
// `2026-12-31T23:59` (no timezone) — `z.string().datetime()` rejects
// that because the strict ISO-8601 grammar requires a Z or ±HH:MM
// offset. Routes that accept BOTH the form value AND a fully-qualified
// ISO string (competitions, etc.) need a slightly looser predicate
// that still refuses arbitrary strings: any value that won't parse
// into a valid Date will hit `new Date('invalid')` → `Invalid Date`
// downstream and Drizzle's timestamp column then bubbles a Postgres
// 22008 → 500. The refinement below catches that at the edge.
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function isParseableDateString(value: string): boolean {
  if (DATETIME_LOCAL_RE.test(value)) return true;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}
const parseableDateTime = z.string().max(50).refine(isParseableDateString, {
  message: 'Must be a valid ISO-8601 datetime (e.g. 2026-12-31T23:59 or 2026-12-31T23:59:00Z)',
});

// ─── Common ────────────────────────────────────────────────────────────

// Audit F-69 (2026-05-07 r4): `.strict()` on the export so direct
// consumers (`validateInput(paginationSchema, ...)`) reject unknown
// keys instead of silently stripping. Spreading consumers (e.g.
// `z.object({ ...paginationSchema.shape, search: z.string() }).strict()`)
// keep working unchanged because they re-build the object before
// applying `.strict()` to the merged shape.
export const paginationSchema = z
  .object({
    page: numericField(z.number().int().min(1)).default(1),
    pageSize: numericField(z.number().int().min(1).max(MAX_PAGE_SIZE)).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type PaginationInput = z.infer<typeof paginationSchema>;

// ─── Horses ────────────────────────────────────────────────────────────
// Audit H-1, H-2, H-3: every create/update schema below uses `.strict()`
// so unknown keys raise a 422 instead of being silently stripped. Without
// strict, a `clubId` or `ownerMemberId` smuggled into the body would be
// dropped today — fine — but the moment a future column with the same
// name is added to the row insert it becomes mass-assignment.

export const createHorseSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    barnName: z.string().max(255).optional(),
    breed: z.string().max(100).optional(),
    gender: z.string().max(20).optional(),
    dateOfBirth: z.string().max(50).optional(),
    color: z.string().max(100).optional(),
    heightHands: optionalNumeric(z.number().positive()),
    weightKg: optionalNumeric(z.number().positive()),
    markings: z.string().max(1000).optional(),
    microchipNumber: z.string().max(100).optional(),
    passportNumber: z.string().max(100).optional(),
    registrationNumber: z.string().max(100).optional(),

    status: z
      .enum(['available', 'resting', 'injured', 'retired', 'off_site', 'sold'])
      .default('available'),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    temperament: z.array(z.string().max(50)).max(20).optional(),
    weightLimitKg: optionalNumeric(z.number().positive()),
    minRiderAge: optionalNumeric(z.number().int().positive()),
    maxLessonsPerDay: numericField(z.number().int().min(1)).default(3),
    mandatoryRestDays: numericField(z.number().int().min(0)).default(1),

    saleStatus: z.enum(['not_for_sale', 'for_sale', 'sold']).default('not_for_sale'),
    // Asset prices are minor-unit integers ≥ 0. Negative values would slip
    // through the prior `.int()` and surface as nonsense in the finance UI.
    purchasePrice: optionalNumeric(z.number().int().min(0)),
    currentValue: optionalNumeric(z.number().int().min(0)),
    salePrice: optionalNumeric(z.number().int().min(0)),

    saddleSize: z.string().max(50).optional(),
    girthSize: z.string().max(50).optional(),
    bridleSize: z.string().max(50).optional(),
    bitType: z.string().max(100).optional(),
    bitSize: z.string().max(50).optional(),
    blanketSize: z.string().max(50).optional(),
    bootsSize: z.string().max(50).optional(),
    gearNotes: z.string().max(2000).optional(),

    insuranceProvider: z.string().max(255).optional(),
    insurancePolicyNumber: z.string().max(100).optional(),
    insuranceCoverage: z.string().max(500).optional(),
    insuranceExpiry: z.string().max(50).optional(),

    primaryPhotoUrl: z.string().url().max(2000).optional(),
    photoUrls: z.array(z.string().url().max(2000)).max(20).optional(),
    notes: z.string().max(2000).optional(),
    ownerMemberId: z.string().uuid().optional(),
  })
  .strict();

/** Input type for forms — fields with .default() are optional */
export type CreateHorseFormValues = z.input<typeof createHorseSchema>;
/** Output type after Zod parsing — defaults applied, for API/DB layer */
export type CreateHorseInput = z.output<typeof createHorseSchema>;

// Ownership transfers must go through POST /api/v1/horses/[horseId]/owner
// so the new owner is validated as a member of the club and the change is
// recorded in the audit log. Keeping `ownerMemberId` on this schema would
// let any caller with `horses:update` reassign ownership to an arbitrary
// UUID via a vanilla PATCH — a mass-assignment hole.
//
// `.strict()` rejects unknown keys at parse time. Without it, a request
// body that smuggled in `totalLessonsCompleted: 9999` or `clubId: 'X'`
// would silently strip those fields — fine today (Drizzle ignores them),
// but a future widening of the queries' SET clause would silently
// expose mass-assignment. See audit G-5.
export const updateHorseSchema = createHorseSchema
  .partial()
  .omit({
    ownerMemberId: true,
  })
  .strict();

export type UpdateHorseInput = z.infer<typeof updateHorseSchema>;

// Audit F-24 (2026-05-06): the schema can't enforce that `ownerMemberId`
// resolves to a member with role `'horse_owner'` or `'rider'` — the role
// isn't in the request body. The caller MUST follow the same pattern as
// `apps/web/app/api/v1/horses/[horseId]/owner/route.ts:40-58`: load the
// member via `getMemberById(ctx.clubId, ownerMemberId)` and refuse if the
// role isn't owner-eligible. Don't ship a new endpoint that uses this
// schema without that guard, or you reintroduce the cross-role smuggle
// hole this comment exists to prevent.
export const transferHorseOwnerSchema = z
  .object({
    // `null` = school horse / no owner.
    ownerMemberId: z.string().uuid().nullable(),
  })
  .strict();

export type TransferHorseOwnerInput = z.output<typeof transferHorseOwnerSchema>;

export const horseFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    status: z.enum(['available', 'resting', 'injured', 'retired', 'off_site', 'sold']).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    ownershipStatus: z.enum(['pending', 'active', 'retired', 'declined']).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export type HorseFiltersInput = z.infer<typeof horseFiltersSchema>;

// ─── Horse Ownership (Round 8 — rider self-registration) ───────────────

/**
 * Rider-facing horse registration. A deliberately shorter form than the
 * admin `createHorseSchema` — riders submit just enough to describe their
 * horse; the admin fills in the rest (gear sizes, insurance, etc.) after
 * approval. `clubId` is required because a rider can be a member of multiple
 * stables and needs to pick which one will stable the horse.
 */
export const registerHorseOwnershipSchema = z
  .object({
    clubId: z.string().uuid('Select a stable'),
    name: z.string().min(1, 'Name is required').max(255),
    breed: z.string().max(100).optional(),
    gender: z.string().max(20).optional(),
    dateOfBirth: z.string().max(50).optional(),
    color: z.string().max(100).optional(),
    heightHands: optionalNumeric(z.number().positive()),
    weightKg: optionalNumeric(z.number().positive()),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    primaryPhotoUrl: z.string().url().max(2000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type RegisterHorseOwnershipFormValues = z.input<typeof registerHorseOwnershipSchema>;
export type RegisterHorseOwnershipInput = z.output<typeof registerHorseOwnershipSchema>;

/**
 * Admin approval. Fee is in minor units (AED fils). A zero fee is legal —
 * it means the stable is housing the owner's horse gratis or billing
 * off-platform — and still flips the record to `active`. The upper cap
 * (`MAX_MONTHLY_LIVERY_FEE_MINOR`) catches order-of-magnitude typos
 * (50000 fils intended, 5000000 entered) before the cron issues a
 * 5-lakh AED invoice; see audit finding B-14.
 */
export const approveHorseOwnershipSchema = z
  .object({
    monthlyLiveryFeeMinor: numericField(z.number().int().min(0).max(MAX_MONTHLY_LIVERY_FEE_MINOR)),
    liveryStartDate: z.string().max(50).min(1, 'Start date is required'),
  })
  .strict();

export type ApproveHorseOwnershipInput = z.output<typeof approveHorseOwnershipSchema>;

export const declineHorseOwnershipSchema = z
  .object({
    reason: z.string().min(1, 'Reason is required').max(1000),
  })
  .strict();

export type DeclineHorseOwnershipInput = z.output<typeof declineHorseOwnershipSchema>;

export const retireHorseOwnershipSchema = z
  .object({
    liveryEndDate: z.string().max(50).optional(),
  })
  .strict();

export type RetireHorseOwnershipInput = z.output<typeof retireHorseOwnershipSchema>;

// ─── Riders ────────────────────────────────────────────────────────────

// `.strict()` — see audit G-5. Without it, a body containing
// `totalLessonsCompleted` or `parentMemberId` would be silently stripped;
// a future widening of the queries' SET clause would expose mass-assignment.
export const updateRiderProfileSchema = z
  .object({
    dateOfBirth: z.string().max(50).optional(),
    weightKg: optionalNumeric(z.number().positive()),
    heightCm: optionalNumeric(z.number().positive()),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    emergencyContactName: z.string().max(255).optional(),
    emergencyContactPhone: z.string().max(50).optional(),
    emergencyContactRelation: z.string().max(100).optional(),
    medicalNotes: z.string().max(5000).optional(),
  })
  .strict();

export type UpdateRiderProfileFormValues = z.input<typeof updateRiderProfileSchema>;
export type UpdateRiderProfileInput = z.output<typeof updateRiderProfileSchema>;

export const riderFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export type RiderFiltersInput = z.infer<typeof riderFiltersSchema>;

export const createRiderSchema = z
  .object({
    displayName: z.string().min(1, 'Name is required').max(255),
    email: z.string().email('Invalid email').max(255),
    phone: z.string().max(50).optional(),
    dateOfBirth: z.string().max(50).optional(),
    weightKg: optionalNumeric(z.number().positive()),
    heightCm: optionalNumeric(z.number().positive()),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    emergencyContactName: z.string().max(255).optional(),
    emergencyContactPhone: z.string().max(50).optional(),
    emergencyContactRelation: z.string().max(100).optional(),
    medicalNotes: z.string().max(5000).optional(),
  })
  .strict();

export type CreateRiderInput = z.output<typeof createRiderSchema>;
export type CreateRiderFormValues = z.input<typeof createRiderSchema>;

// ─── Lesson Types ──────────────────────────────────────────────────────

// Audit F-62 (2026-05-08 r6): hex color regex shared between branding
// + lesson types. Defined here (before its first use) instead of
// further down with `updateBrandingSchema` to avoid the TDZ trap.
export const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'Must be a hex color like #6366f1')
  .transform((v) => v.toLowerCase());

// Inner object so `updateLessonTypeSchema = .partial()` keeps working —
// Zod's `.partial()` is only defined on ZodObject, not the ZodEffects
// produced by `.refine(...)`. Both the create and update schemas wrap
// this base + share the F-28 minRiders<=maxRiders refinement.
const lessonTypeFields = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    type: z.string().min(1, 'Type is required').max(100),
    description: z.string().max(2000).optional(),
    durationMinutes: numericField(z.number().int().min(15)).default(60),
    price: numericField(z.number().int().min(0)),
    currency: currencyField.default('AED'),
    maxRiders: numericField(z.number().int().min(1)).default(1),
    minRiders: numericField(z.number().int().min(1)).default(1),
    maxSessionsPerDay: optionalNumeric(z.number().int().positive()),
    arenaId: z.string().uuid().optional(),
    // Audit F-62 (2026-05-08 r6): use the shared hex regex —
    // previously `z.string().max(7)` silently accepted `'red'`.
    color: hexColor.optional(),
  })
  .strict();

export const createLessonTypeSchema = lessonTypeFields
  // Audit F-28 (2026-05-08 r6): client-side mirror of the new
  // `lesson_types_riders_minmax_check` DB constraint (migration 0049).
  // A misclick (`min=4, max=2`) silently produces a lesson type that
  // never matches any slot — refuse it at the API boundary too.
  .refine((val) => val.minRiders <= val.maxRiders, {
    message: 'minRiders cannot exceed maxRiders',
    path: ['minRiders'],
  });

export type CreateLessonTypeFormValues = z.input<typeof createLessonTypeSchema>;
export type CreateLessonTypeInput = z.output<typeof createLessonTypeSchema>;

// `.strict()` — see audit G-5. Audit F-28: PATCH only validates the
// invariant when both fields are sent in the same payload (Zod skips
// the refine when either is undefined).
export const updateLessonTypeSchema = lessonTypeFields
  .partial()
  .strict()
  .refine(
    (val) =>
      val.minRiders === undefined || val.maxRiders === undefined || val.minRiders <= val.maxRiders,
    {
      message: 'minRiders cannot exceed maxRiders',
      path: ['minRiders'],
    },
  );

// ─── Arenas ────────────────────────────────────────────────────────────

export const createArenaSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    capacity: optionalNumeric(z.number().int().positive()),
    surfaceType: z.string().max(100).optional(),
    hasLighting: z.boolean().default(false),
    isIndoor: z.boolean().default(false),
  })
  .strict();

export type CreateArenaInput = z.infer<typeof createArenaSchema>;

// `.strict()` — see audit G-5.
export const updateArenaSchema = createArenaSchema.partial().strict();

// ─── Booking Slots ─────────────────────────────────────────────────────

export const createBookingSlotSchema = z
  .object({
    lessonTypeId: z.string().uuid(),
    arenaId: z.string().uuid().optional(),
    coachMemberId: z.string().uuid().optional(),
    date: z.string().max(50).min(1, 'Date is required'),
    startTime: z.string().max(20).min(1, 'Start time is required'),
    endTime: z.string().max(20).min(1, 'End time is required'),
    maxRiders: numericField(z.number().int().min(1)),
  })
  .strict();

export type CreateBookingSlotInput = z.infer<typeof createBookingSlotSchema>;

// Audit G-16: dateFrom / dateTo are calendar-date strings (YYYY-MM-DD).
// The bulk-slots route's day-of-week loop uses `new Date(...).getDay()`
// which interprets a bare YYYY-MM-DD as UTC midnight; that's safe ONLY
// for calendar-date input (UTC midnight Sunday is local Sunday in any
// reasonable timezone). The previous schema accepted `z.string().max(50)`,
// which would have admitted ISO datetimes with offsets and silently
// shifted day-of-week to the wrong calendar day. Locking to the regex
// here means a future frontend change can't widen the contract.
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createRecurringSlotsSchema = z
  .object({
    lessonTypeId: z.string().uuid(),
    arenaId: z.string().uuid().optional(),
    coachMemberId: z.string().uuid().optional(),
    startTime: z.string().max(20).min(1, 'Start time is required'),
    endTime: z.string().max(20).min(1, 'End time is required'),
    maxRiders: numericField(z.number().int().min(1)),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one day').max(7),
    dateFrom: z.string().regex(CALENDAR_DATE_RE, 'Start date must be YYYY-MM-DD'),
    dateTo: z.string().regex(CALENDAR_DATE_RE, 'End date must be YYYY-MM-DD'),
  })
  .strict();

export type CreateRecurringSlotsFormValues = z.input<typeof createRecurringSlotsSchema>;
export type CreateRecurringSlotsInput = z.output<typeof createRecurringSlotsSchema>;

// ─── Bookings ──────────────────────────────────────────────────────────

export const guestRiderSchema = z
  .object({
    name: z.string().min(1, 'Guest name is required').max(255),
    email: z.string().email('Valid email required').max(255),
    phone: z.string().min(1, 'Phone is required').max(50),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  })
  .strict();

export type GuestRiderInput = z.infer<typeof guestRiderSchema>;

export const createBookingSchema = z
  .object({
    slotId: z.string().uuid(),
    riderMemberId: z.string().uuid(),
    horseId: z.string().uuid().optional(),
    // Audit 2026-05-13 (P1): derived from canonical PAYMENT_METHOD_VALUES
    // tuple in `types/index.ts` so booking-input, competition-entry input,
    // and the response schema all stay in sync. Previously inlined here
    // (four duplicate copies of the same 12 literals).
    paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
    couponCode: z.string().max(50).optional(),
    autoMatchHorse: z.boolean().default(true),
    // When present, this booking is for a guest (non-member). `riderMemberId`
    // still refers to the signed-in booker; the guest's contact info rides on
    // the booking row itself. Riders can only book themselves once per slot,
    // but they can book multiple guests on the same slot (each by unique email).
    guest: guestRiderSchema.optional(),
  })
  .strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z
  .object({
    reason: z.string().min(1, 'Cancellation reason is required').max(1000),
  })
  .strict();

export const bookingFiltersSchema = z
  .object({
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
    date: z.string().max(50).optional(),
    lessonTypeId: z.string().uuid().optional(),
    riderMemberId: z.string().uuid().optional(),
    ...paginationSchema.shape,
  })
  .strict();

export type BookingFiltersInput = z.infer<typeof bookingFiltersSchema>;

// ─── Competitions ─────────────────────────────────────────────────────

const COMPETITION_STATUSES = [
  'draft',
  'published',
  'in_progress',
  'completed',
  'cancelled',
] as const;

// `.strict()` for parity with update schemas — unknown keys 422 instead
// of being silently stripped (audit QA-32c).
export const createCompetitionSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    description: z.string().max(2000).optional(),
    startDate: z.string().max(50).min(1, 'Start date is required'),
    endDate: z.string().max(50).min(1, 'End date is required'),
    location: z.string().max(500).optional(),
    arenaId: z.string().uuid().optional(),
    disciplines: z.array(z.string().max(100)).max(50).optional(),
    entryFee: optionalNumeric(z.number().int().min(0)),
    currency: currencyField.default('AED'),
    // Audit F-38 (2026-05-07 r5): refuse arbitrary strings — the route
    // either passes this through `parseDateTimeLocal` (datetime-local
    // form value, no TZ) or through `new Date(...)` directly (ISO with
    // Z / offset). Either path crashes Drizzle's `timestamp` column on
    // a malformed input. `parseableDateTime` accepts both forms and
    // rejects everything else.
    registrationDeadline: parseableDateTime.optional(),
    maxParticipants: optionalNumeric(z.number().int().positive()),
    status: z.enum(COMPETITION_STATUSES).default('draft'),
  })
  .strict();

export type CreateCompetitionFormValues = z.input<typeof createCompetitionSchema>;
export type CreateCompetitionInput = z.output<typeof createCompetitionSchema>;

// `.strict()` — see audit G-5.
export const updateCompetitionSchema = createCompetitionSchema.partial().strict();
export type UpdateCompetitionInput = z.output<typeof updateCompetitionSchema>;

export const competitionFiltersSchema = z
  .object({
    status: z.enum(COMPETITION_STATUSES).optional(),
    dateFrom: z.string().max(50).optional(),
    dateTo: z.string().max(50).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export type CompetitionFiltersInput = z.output<typeof competitionFiltersSchema>;

export const createCompetitionClassSchema = z
  .object({
    name: z.string().min(1, 'Class name is required').max(255),
    discipline: z.string().max(100).optional(),
    level: z.string().max(100).optional(),
    maxEntries: optionalNumeric(z.number().int().positive()),
    entryFee: optionalNumeric(z.number().int().min(0)),
    currency: currencyField.default('AED'),
    sortOrder: numericField(z.number().int().min(0)).default(0),
  })
  .strict();

export type CreateCompetitionClassInput = z.output<typeof createCompetitionClassSchema>;

export const updateCompetitionClassSchema = createCompetitionClassSchema.partial().strict();

// Entry fee is intentionally NOT accepted from the request — it's stamped
// server-side from `competitionClasses.entryFee`. Accepting `amount` from
// the body lets a rider POST `{ amount: 1 }` and pay 1 fil for a
// full-price competition (same class of bug as the historical bookings
// price-injection fix).
//
// Audit 2026-05-13 (P1): `paymentMethod` derives from PAYMENT_METHOD_VALUES
// in types/index.ts (canonical source for input + response).
export const createCompetitionEntrySchema = z
  .object({
    riderMemberId: z.string().uuid(),
    horseId: z.string().uuid().optional(),
    paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
  })
  .strict();

export type CreateCompetitionEntryInput = z.output<typeof createCompetitionEntrySchema>;

export const createCompetitionResultSchema = z
  .object({
    entryId: z.string().uuid(),
    placing: optionalNumeric(z.number().int().positive()),
    timeSeconds: optionalNumeric(z.number().positive()),
    faults: numericField(z.number().int().min(0)).default(0),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type CreateCompetitionResultInput = z.output<typeof createCompetitionResultSchema>;

// ─── Settings ─────────────────────────────────────────────────────────

export const updateClubProfileSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(50).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    timezone: z.string().max(50).optional(),
    currency: currencyField.optional(),
    // Nullable to match the underlying column (text, no NOT NULL) and the
    // branding schema's shape — staff need to be able to *clear* the logo
    // from the profile editor too, not just set a new one.
    logoUrl: nullableOptionalUrl,
    websiteUrl: optionalUrl,
    socialInstagram: z.string().max(255).optional(),
    socialFacebook: z.string().max(255).optional(),
    socialTiktok: z.string().max(255).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type UpdateClubProfileInput = z.output<typeof updateClubProfileSchema>;

// `hexColor` defined above (audit F-62, before `createLessonTypeSchema`).
export const updateBrandingSchema = z
  .object({
    brandPrimaryColor: hexColor.optional(),
    brandSecondaryColor: hexColor.optional(),
    logoUrl: nullableOptionalUrl,
    coverPhotoUrl: nullableOptionalUrl,
    faviconUrl: nullableOptionalUrl,
  })
  .strict();

export type UpdateBrandingInput = z.output<typeof updateBrandingSchema>;

const notificationChannel = z.object({ email: z.boolean() });

export const updateNotificationsSchema = z
  .object({
    notificationPreferences: z
      .object({
        booking_confirmation: notificationChannel.optional(),
        booking_reminder_24h: notificationChannel.optional(),
        booking_cancellation: notificationChannel.optional(),
        payment_receipt: notificationChannel.optional(),
        payment_failed: notificationChannel.optional(),
        feed_alert: notificationChannel.optional(),
        waitlist_promotion: notificationChannel.optional(),
        rider_welcome: notificationChannel.optional(),
        invoice_issued: notificationChannel.optional(),
        // Round 8 / 8.5 — horse ownership + livery billing
        horse_registration_submitted: notificationChannel.optional(),
        horse_registration_approved: notificationChannel.optional(),
        horse_registration_declined: notificationChannel.optional(),
        livery_invoice_issued: notificationChannel.optional(),
        livery_payment_received: notificationChannel.optional(),
        livery_invoice_overdue: notificationChannel.optional(),
        // Round 6.2 — horse care reminders
        horse_care_reminder: notificationChannel.optional(),
      })
      .strict(),
  })
  .strict();

export type UpdateNotificationsInput = z.output<typeof updateNotificationsSchema>;

export const updateDiscoverySchema = z
  .object({
    isPublicListing: z.boolean().optional(),
    // Only two modes: open (public, instant join) or invite_only (private).
    // Legacy 'approval' values coming from old records are accepted for
    // backwards compatibility — the join endpoint treats them as invite_only.
    joinPolicy: z.enum(['open', 'invite_only', 'approval']).optional(),
    shortDescription: z.string().max(280).nullable().optional(),
  })
  .strict();

export type UpdateDiscoveryInput = z.output<typeof updateDiscoverySchema>;

export const updateBookingRulesSchema = z
  .object({
    advanceBookingDays: optionalNumeric(z.number().int().min(1).max(365)),
    bookingCutoffHours: optionalNumeric(z.number().int().min(0)),
    cancellationNoticeHours: optionalNumeric(z.number().int().min(0)),
    // 2026-05-16 — per-club grace before the booking-payment-timeout cron
    // auto-cancels an unpaid confirmed booking. Bounds mirror the DB CHECK
    // constraint (`clubs_booking_payment_timeout_minutes_range`, 1..60).
    bookingPaymentTimeoutMinutes: optionalNumeric(z.number().int().min(1).max(60)),
    defaultLessonDurationMinutes: optionalNumeric(z.number().int().min(15)),
    allowOverbooking: z.boolean().optional(),
    overbookingLimit: optionalNumeric(z.number().int().min(0)),
    defaultCalendarView: z.enum(['day', 'week', 'month', 'agenda']).optional(),
    lateCancellationFeePercent: optionalNumeric(z.number().min(0).max(100)),
    noShowFeePercent: optionalNumeric(z.number().min(0).max(100)),
  })
  .strict()
  // Audit 2026-05-13 (P2): refuse no-field payloads — matches the pattern
  // already on `updateExpenseSchema`. Without it, an empty `{}` PATCH
  // succeeded and ran an `updated_at`-only UPDATE, confusing diagnostics.
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateBookingRulesInput = z.output<typeof updateBookingRulesSchema>;

// ─── Staff ────────────────────────────────────────────────────────────

export const createStaffSchema = z
  .object({
    displayName: z.string().min(1, 'Name is required').max(255),
    email: z.string().email().max(255),
    phone: z.string().max(50).optional(),
    role: z.enum(['club_manager', 'coach', 'groom']),
  })
  .strict();

export type CreateStaffInput = z.output<typeof createStaffSchema>;

// `.strict()` — see audit G-5.
export const updateStaffSchema = createStaffSchema.partial().strict();
export type UpdateStaffInput = z.output<typeof updateStaffSchema>;

export const staffFiltersSchema = z
  .object({
    search: z.string().max(200).optional(),
    role: z.string().max(50).optional(),
    ...paginationSchema.shape,
  })
  .strict();

// ─── Owners ───────────────────────────────────────────────────────────

export const createOwnerSchema = z
  .object({
    displayName: z.string().min(1, 'Name is required').max(255),
    email: z.string().email().max(255),
    phone: z.string().max(50).optional(),
  })
  .strict();

export type CreateOwnerInput = z.output<typeof createOwnerSchema>;

// `.strict()` — see audit G-5. Caller must use this rather than
// `createOwnerSchema.partial()` so unknown keys 422 instead of being
// silently stripped (e.g. `role: 'club_admin'` mass-assignment).
export const updateOwnerSchema = createOwnerSchema.partial().strict();
export type UpdateOwnerInput = z.output<typeof updateOwnerSchema>;

// ─── Finances ─────────────────────────────────────────────────────────

// `.strict()` (audit QA-32c) — see createCompetitionSchema rationale.
// Audit 2026-05-13 (P1): `amount` is intentionally a positive number in
// MAJOR units (e.g., `12.50` AED). The expenses route runs `toMinorUnits`
// to convert before insert; the DB column `expenses.amount` is `integer`
// (minor units). Asymmetry vs `purchasePrice`/`currentValue`/`salePrice`
// elsewhere in this file, which are pre-converted minor-unit integers
// from the form. Do NOT change to `.int()` without also moving the
// conversion onto the form.
export const createExpenseSchema = z
  .object({
    category: z.string().min(1).max(100),
    description: z.string().min(1).max(2000),
    amount: numericField(z.number().positive()),
    currency: currencyField.default('AED'),
    date: z.string().max(50).min(1, 'Date is required'),
    horseId: z.string().uuid().optional(),
    vendorName: z.string().max(255).optional(),
  })
  .strict();

export type CreateExpenseFormValues = z.input<typeof createExpenseSchema>;
export type CreateExpenseInput = z.output<typeof createExpenseSchema>;

// `.strict()` — see audit G-5. Combined with the non-empty refine so a
// body with `{}` 422s rather than running an updatedAt-only UPDATE.
export const updateExpenseSchema = createExpenseSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateExpenseFormValues = z.input<typeof updateExpenseSchema>;
export type UpdateExpenseInput = z.output<typeof updateExpenseSchema>;

export const expenseFiltersSchema = z
  .object({
    category: z.string().max(100).optional(),
    dateFrom: z.string().max(50).optional(),
    dateTo: z.string().max(50).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export const invoiceFiltersSchema = z
  .object({
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(),
    ...paginationSchema.shape,
  })
  .strict();

export type InvoiceFiltersInput = z.output<typeof invoiceFiltersSchema>;

// Base ZodObject — used for `.partial().strict()` on the update schema.
// The update route can't apply `.partial()` directly on the refined version
// because superRefine returns ZodEffects (not ZodObject). Audit QA-21/QA-24/QA-32c.
export const couponBaseSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(50)
      .transform((v) => v.toUpperCase()),
    discountType: z.enum(['percentage', 'fixed']),
    // Stored as integer; for 'percentage' the unit is whole percent points
    // (1–100), for 'fixed' the unit is minor currency units (fils/cents).
    // The percentage cap is enforced in `couponPercentageRefine`.
    discountValue: numericField(z.number().int().positive()),
    // Cap on the absolute discount in minor units. Optional for fixed
    // (the value itself is the cap); meaningful for percentage to bound
    // a percent on a large order.
    maxDiscount: optionalNumeric(z.number().int().positive()),
    minimumAmount: optionalNumeric(z.number().int().nonnegative()),
    maxUses: optionalNumeric(z.number().int().positive()),
    maxUsesPerRider: optionalNumeric(z.number().int().positive()),
    firstTimeOnly: z.boolean().default(false),
    isStackable: z.boolean().default(false),
    startsAt: z.string().max(50).optional(),
    expiresAt: z.string().max(50).optional(),
    // Audit pass-3 follow-up C (2026-05-09): coupon currency. Optional
    // at the schema level so the route layer can default it from the
    // club's currency when omitted (the typical UX path). When the
    // operator passes one explicitly it must be a 3-letter ISO code.
    currency: currencyField.optional(),
  })
  // `.strict()` for parity with update schemas — unknown keys 422
  // instead of being silently stripped (audit QA-32c).
  .strict();

// Reusable refine: percentage discounts must be in [1,100]. Hoisted so the
// update route can compose .partial().superRefine(couponPercentageRefine).
function couponPercentageRefine<
  T extends { discountType?: 'percentage' | 'fixed'; discountValue?: number },
>(data: T, ctx: z.RefinementCtx): void {
  if (
    data.discountType === 'percentage' &&
    typeof data.discountValue === 'number' &&
    data.discountValue > 100
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountValue'],
      message: 'Percentage discount must be between 1 and 100',
    });
  }
}

export const createCouponSchema = couponBaseSchema.superRefine(couponPercentageRefine);
// Re-exported so the update route in app/api/v1/finances/coupons/[couponId]
// can compose `.partial().strict().superRefine(couponPercentageRefine)`.
export { couponPercentageRefine };

export type CreateCouponFormValues = z.input<typeof createCouponSchema>;
export type CreateCouponInput = z.output<typeof createCouponSchema>;

// ─── Horse Health ─────────────────────────────────────────────────────

// Audit 2026-05-13: HEALTH_RECORD_TYPES const-array removed — the
// schema accepts free-form `recordType: z.string().min(1).max(50)`
// and the list was never consumed. If we ever want to constrain the
// values, add them back as `z.enum(HEALTH_RECORD_TYPES)` here.

// `.strict()` (audit QA-32c) — see createCompetitionSchema rationale.
export const createHealthRecordSchema = z
  .object({
    recordType: z.string().min(1).max(50),
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().max(2000).optional(),
    date: z.string().max(50).min(1, 'Date is required'),
    nextDueDate: z.string().max(50).optional(),
    vetName: z.string().max(255).optional(),
    vetClinic: z.string().max(255).optional(),
    diagnosis: z.string().max(5000).optional(),
    treatment: z.string().max(5000).optional(),
    cost: optionalNumeric(z.number().int().min(0)),
    recoveryTimeDays: optionalNumeric(z.number().int().min(0)),
    followUpNeeded: z.boolean().default(false),
    followUpDate: z.string().max(50).optional(),
    batchNumber: z.string().max(100).optional(),
    productUsed: z.string().max(255).optional(),
    documentUrls: z.array(z.string().url().max(2000)).max(20).optional(),
  })
  .strict();

export type CreateHealthRecordFormValues = z.input<typeof createHealthRecordSchema>;
export type CreateHealthRecordInput = z.output<typeof createHealthRecordSchema>;

export const createMedicationSchema = z
  .object({
    medicationName: z.string().min(1, 'Medication name is required').max(255),
    dosage: z.string().min(1, 'Dosage is required').max(100),
    frequency: z.string().min(1, 'Frequency is required').max(100),
    timeOfDay: z.array(z.string().max(50)).max(10).optional(),
    startDate: z.string().max(50).min(1, 'Start date is required'),
    endDate: z.string().max(50).optional(),
    isActive: z.boolean().default(true),
    prescribedBy: z.string().max(255).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type CreateMedicationInput = z.output<typeof createMedicationSchema>;
// `.strict()` — see audit G-5.
export const updateMedicationSchema = createMedicationSchema.partial().strict();

export const createMedicationLogSchema = z
  .object({
    medicationId: z.string().uuid(),
    // Audit F-38 (2026-05-07 r5): ISO-8601 strict datetime. The route
    // converts via `new Date(data.administeredAt)` and Drizzle's
    // `timestamp` column rejects an `Invalid Date` with Postgres 22008
    // (datetime-field-overflow), surfacing as a 500 INTERNAL_ERROR with
    // no field-level context. `.datetime()` rejects malformed input at
    // the validation layer with a 400 + path: ['administeredAt'] payload.
    administeredAt: z.string().datetime(),
    administeredByMemberId: z.string().uuid().optional(),
    wasAdministered: z.boolean().default(true),
    skipReason: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type CreateMedicationLogInput = z.output<typeof createMedicationLogSchema>;

export const createFeedingPlanSchema = z
  .object({
    mealName: z.string().min(1, 'Meal name is required').max(100),
    feedType: z.string().max(255).optional(),
    quantityKg: optionalNumeric(z.number().positive()),
    supplements: z.array(z.string().max(100)).max(20).optional(),
    notes: z.string().max(2000).optional(),
    timeOfDay: z.string().max(50).optional(),
  })
  .strict();

export type CreateFeedingPlanFormValues = z.input<typeof createFeedingPlanSchema>;
export type CreateFeedingPlanInput = z.output<typeof createFeedingPlanSchema>;
export const updateFeedingPlanSchema = createFeedingPlanSchema.partial().strict();

export const createExerciseScheduleSchema = z
  .object({
    dayOfWeek: numericField(z.number().int().min(0).max(6)),
    exerciseType: z.string().min(1, 'Exercise type is required').max(100),
    durationMinutes: optionalNumeric(z.number().int().positive()),
    intensity: z.string().max(20).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type CreateExerciseScheduleFormValues = z.input<typeof createExerciseScheduleSchema>;
export type CreateExerciseScheduleInput = z.output<typeof createExerciseScheduleSchema>;
export const updateExerciseScheduleSchema = createExerciseScheduleSchema.partial().strict();

const FILE_CATEGORIES = [
  'medical_report',
  'blood_test',
  'xray',
  'competition_result',
  'registration',
  'insurance',
  'purchase_agreement',
  'vaccination_certificate',
  'other',
] as const;

export const createDocumentSchema = z
  .object({
    fileName: z.string().min(1, 'File name is required').max(255),
    fileUrl: z.string().url('Valid URL required').max(2000),
    fileSizeBytes: optionalNumeric(z.number().int().positive()),
    fileType: z.string().max(50).optional(),
    category: z.enum(FILE_CATEGORIES).default('other'),
    description: z.string().max(2000).optional(),
  })
  .strict();

export type CreateDocumentInput = z.output<typeof createDocumentSchema>;
