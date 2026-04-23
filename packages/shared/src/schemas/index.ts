import { z } from 'zod';

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

// ─── Common ────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: numericField(z.number().int().min(1)).default(1),
  pageSize: numericField(z.number().int().min(1).max(100)).default(25),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ─── Horses ────────────────────────────────────────────────────────────

export const createHorseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  barnName: z.string().max(255).optional(),
  breed: z.string().max(100).optional(),
  gender: z.string().max(20).optional(),
  dateOfBirth: z.string().optional(),
  color: z.string().max(100).optional(),
  heightHands: optionalNumeric(z.number().positive()),
  weightKg: optionalNumeric(z.number().positive()),
  markings: z.string().optional(),
  microchipNumber: z.string().max(100).optional(),
  passportNumber: z.string().max(100).optional(),
  registrationNumber: z.string().max(100).optional(),

  status: z.enum(['available', 'resting', 'injured', 'retired', 'off_site', 'sold']).default('available'),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  temperament: z.array(z.string()).optional(),
  weightLimitKg: optionalNumeric(z.number().positive()),
  minRiderAge: optionalNumeric(z.number().int().positive()),
  maxLessonsPerDay: numericField(z.number().int().min(1)).default(3),
  mandatoryRestDays: numericField(z.number().int().min(0)).default(1),

  saleStatus: z.enum(['not_for_sale', 'for_sale', 'sold']).default('not_for_sale'),
  purchasePrice: optionalNumeric(z.number().int()),
  currentValue: optionalNumeric(z.number().int()),
  salePrice: optionalNumeric(z.number().int()),

  saddleSize: z.string().max(50).optional(),
  girthSize: z.string().max(50).optional(),
  bridleSize: z.string().max(50).optional(),
  bitType: z.string().max(100).optional(),
  bitSize: z.string().max(50).optional(),
  blanketSize: z.string().max(50).optional(),
  bootsSize: z.string().max(50).optional(),
  gearNotes: z.string().optional(),

  insuranceProvider: z.string().max(255).optional(),
  insurancePolicyNumber: z.string().max(100).optional(),
  insuranceCoverage: z.string().optional(),
  insuranceExpiry: z.string().optional(),

  primaryPhotoUrl: z.string().url().optional(),
  photoUrls: z.array(z.string().url()).optional(),
  notes: z.string().optional(),
  ownerMemberId: z.string().uuid().optional(),
});

/** Input type for forms — fields with .default() are optional */
export type CreateHorseFormValues = z.input<typeof createHorseSchema>;
/** Output type after Zod parsing — defaults applied, for API/DB layer */
export type CreateHorseInput = z.output<typeof createHorseSchema>;

export const updateHorseSchema = createHorseSchema.partial();

export type UpdateHorseInput = z.infer<typeof updateHorseSchema>;

export const horseFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['available', 'resting', 'injured', 'retired', 'off_site', 'sold']).optional(),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  ownershipStatus: z.enum(['pending', 'active', 'retired', 'declined']).optional(),
  ...paginationSchema.shape,
});

export type HorseFiltersInput = z.infer<typeof horseFiltersSchema>;

// ─── Horse Ownership (Round 8 — rider self-registration) ───────────────

/**
 * Rider-facing horse registration. A deliberately shorter form than the
 * admin `createHorseSchema` — riders submit just enough to describe their
 * horse; the admin fills in the rest (gear sizes, insurance, etc.) after
 * approval. `clubId` is required because a rider can be a member of multiple
 * stables and needs to pick which one will stable the horse.
 */
export const registerHorseOwnershipSchema = z.object({
  clubId: z.string().uuid('Select a stable'),
  name: z.string().min(1, 'Name is required').max(255),
  breed: z.string().max(100).optional(),
  gender: z.string().max(20).optional(),
  dateOfBirth: z.string().optional(),
  color: z.string().max(100).optional(),
  heightHands: optionalNumeric(z.number().positive()),
  weightKg: optionalNumeric(z.number().positive()),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  primaryPhotoUrl: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
});

export type RegisterHorseOwnershipFormValues = z.input<typeof registerHorseOwnershipSchema>;
export type RegisterHorseOwnershipInput = z.output<typeof registerHorseOwnershipSchema>;

/**
 * Admin approval. Fee is in minor units (AED fils). A zero fee is legal —
 * it means the stable is housing the owner's horse gratis or billing
 * off-platform — and still flips the record to `active`.
 */
export const approveHorseOwnershipSchema = z.object({
  monthlyLiveryFeeMinor: numericField(z.number().int().min(0)),
  liveryStartDate: z.string().min(1, 'Start date is required'),
});

export type ApproveHorseOwnershipInput = z.output<typeof approveHorseOwnershipSchema>;

export const declineHorseOwnershipSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(1000),
});

export type DeclineHorseOwnershipInput = z.output<typeof declineHorseOwnershipSchema>;

export const retireHorseOwnershipSchema = z.object({
  liveryEndDate: z.string().optional(),
});

export type RetireHorseOwnershipInput = z.output<typeof retireHorseOwnershipSchema>;

// ─── Riders ────────────────────────────────────────────────────────────

export const updateRiderProfileSchema = z.object({
  dateOfBirth: z.string().optional(),
  weightKg: optionalNumeric(z.number().positive()),
  heightCm: optionalNumeric(z.number().positive()),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  emergencyContactName: z.string().max(255).optional(),
  emergencyContactPhone: z.string().max(50).optional(),
  emergencyContactRelation: z.string().max(100).optional(),
  medicalNotes: z.string().optional(),
});

export type UpdateRiderProfileFormValues = z.input<typeof updateRiderProfileSchema>;
export type UpdateRiderProfileInput = z.output<typeof updateRiderProfileSchema>;

export const riderFiltersSchema = z.object({
  search: z.string().optional(),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  ...paginationSchema.shape,
});

export type RiderFiltersInput = z.infer<typeof riderFiltersSchema>;

export const createRiderSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email').max(255),
  phone: z.string().max(50).optional(),
  dateOfBirth: z.string().optional(),
  weightKg: optionalNumeric(z.number().positive()),
  heightCm: optionalNumeric(z.number().positive()),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  emergencyContactName: z.string().max(255).optional(),
  emergencyContactPhone: z.string().max(50).optional(),
  emergencyContactRelation: z.string().max(100).optional(),
  medicalNotes: z.string().optional(),
});

export type CreateRiderInput = z.output<typeof createRiderSchema>;
export type CreateRiderFormValues = z.input<typeof createRiderSchema>;

// ─── Lesson Types ──────────────────────────────────────────────────────

export const createLessonTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.string().min(1, 'Type is required').max(100),
  description: z.string().optional(),
  durationMinutes: numericField(z.number().int().min(15)).default(60),
  price: numericField(z.number().int().min(0)),
  currency: z.string().length(3).default('AED'),
  maxRiders: numericField(z.number().int().min(1)).default(1),
  minRiders: numericField(z.number().int().min(1)).default(1),
  maxSessionsPerDay: optionalNumeric(z.number().int().positive()),
  arenaId: z.string().uuid().optional(),
  color: z.string().max(7).optional(),
});

export type CreateLessonTypeFormValues = z.input<typeof createLessonTypeSchema>;
export type CreateLessonTypeInput = z.output<typeof createLessonTypeSchema>;

export const updateLessonTypeSchema = createLessonTypeSchema.partial();

// ─── Arenas ────────────────────────────────────────────────────────────

export const createArenaSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  capacity: optionalNumeric(z.number().int().positive()),
  surfaceType: z.string().max(100).optional(),
  hasLighting: z.boolean().default(false),
  isIndoor: z.boolean().default(false),
});

export type CreateArenaInput = z.infer<typeof createArenaSchema>;

export const updateArenaSchema = createArenaSchema.partial();

// ─── Booking Slots ─────────────────────────────────────────────────────

export const createBookingSlotSchema = z.object({
  lessonTypeId: z.string().uuid(),
  arenaId: z.string().uuid().optional(),
  coachMemberId: z.string().uuid().optional(),
  date: z.string().min(1, 'Date is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  maxRiders: numericField(z.number().int().min(1)),
});

export type CreateBookingSlotInput = z.infer<typeof createBookingSlotSchema>;

export const createRecurringSlotsSchema = z.object({
  lessonTypeId: z.string().uuid(),
  arenaId: z.string().uuid().optional(),
  coachMemberId: z.string().uuid().optional(),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  maxRiders: numericField(z.number().int().min(1)),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one day'),
  dateFrom: z.string().min(1, 'Start date is required'),
  dateTo: z.string().min(1, 'End date is required'),
});

export type CreateRecurringSlotsFormValues = z.input<typeof createRecurringSlotsSchema>;
export type CreateRecurringSlotsInput = z.output<typeof createRecurringSlotsSchema>;

// ─── Bookings ──────────────────────────────────────────────────────────

export const guestRiderSchema = z.object({
  name: z.string().min(1, 'Guest name is required').max(255),
  email: z.string().email('Valid email required').max(255),
  phone: z.string().min(1, 'Phone is required').max(50),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']),
});

export type GuestRiderInput = z.infer<typeof guestRiderSchema>;

export const createBookingSchema = z.object({
  slotId: z.string().uuid(),
  riderMemberId: z.string().uuid(),
  horseId: z.string().uuid().optional(),
  paymentMethod: z.enum([
    'card', 'apple_pay', 'google_pay', 'tabby', 'tamara', 'knet',
    'mada', 'benefit', 'cash', 'card_in_person', 'package_credit', 'bank_transfer',
  ]).optional(),
  amount: optionalNumeric(z.number().int()),
  couponCode: z.string().optional(),
  autoMatchHorse: z.boolean().default(true),
  // When present, this booking is for a guest (non-member). `riderMemberId`
  // still refers to the signed-in booker; the guest's contact info rides on
  // the booking row itself. Riders can only book themselves once per slot,
  // but they can book multiple guests on the same slot (each by unique email).
  guest: guestRiderSchema.optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required'),
});

export const bookingFiltersSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  date: z.string().optional(),
  lessonTypeId: z.string().uuid().optional(),
  riderMemberId: z.string().uuid().optional(),
  ...paginationSchema.shape,
});

export type BookingFiltersInput = z.infer<typeof bookingFiltersSchema>;

// ─── Competitions ─────────────────────────────────────────────────────

const COMPETITION_STATUSES = ['draft', 'published', 'in_progress', 'completed', 'cancelled'] as const;

export const createCompetitionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  location: z.string().max(500).optional(),
  arenaId: z.string().uuid().optional(),
  disciplines: z.array(z.string().max(100)).optional(),
  entryFee: optionalNumeric(z.number().int().min(0)),
  currency: z.string().length(3).default('AED'),
  registrationDeadline: z.string().optional(),
  maxParticipants: optionalNumeric(z.number().int().positive()),
  status: z.enum(COMPETITION_STATUSES).default('draft'),
});

export type CreateCompetitionFormValues = z.input<typeof createCompetitionSchema>;
export type CreateCompetitionInput = z.output<typeof createCompetitionSchema>;

export const updateCompetitionSchema = createCompetitionSchema.partial();
export type UpdateCompetitionInput = z.output<typeof updateCompetitionSchema>;

export const competitionFiltersSchema = z.object({
  status: z.enum(COMPETITION_STATUSES).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ...paginationSchema.shape,
});

export type CompetitionFiltersInput = z.output<typeof competitionFiltersSchema>;

export const createCompetitionClassSchema = z.object({
  name: z.string().min(1, 'Class name is required').max(255),
  discipline: z.string().max(100).optional(),
  level: z.string().max(100).optional(),
  maxEntries: optionalNumeric(z.number().int().positive()),
  entryFee: optionalNumeric(z.number().int().min(0)),
  currency: z.string().length(3).default('AED'),
  sortOrder: numericField(z.number().int().min(0)).default(0),
});

export type CreateCompetitionClassInput = z.output<typeof createCompetitionClassSchema>;

export const updateCompetitionClassSchema = createCompetitionClassSchema.partial();

const PAYMENT_METHODS = [
  'card', 'apple_pay', 'google_pay', 'tabby', 'tamara', 'knet',
  'mada', 'benefit', 'cash', 'card_in_person', 'package_credit', 'bank_transfer',
] as const;

export const createCompetitionEntrySchema = z.object({
  riderMemberId: z.string().uuid(),
  horseId: z.string().uuid().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  amount: optionalNumeric(z.number().int()),
});

export type CreateCompetitionEntryInput = z.output<typeof createCompetitionEntrySchema>;

export const createCompetitionResultSchema = z.object({
  entryId: z.string().uuid(),
  placing: optionalNumeric(z.number().int().positive()),
  timeSeconds: optionalNumeric(z.number().positive()),
  faults: numericField(z.number().int().min(0)).default(0),
  notes: z.string().optional(),
});

export type CreateCompetitionResultInput = z.output<typeof createCompetitionResultSchema>;

// ─── Settings ─────────────────────────────────────────────────────────

export const updateClubProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  currency: z.string().length(3).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  socialInstagram: z.string().optional(),
  socialFacebook: z.string().optional(),
  socialTiktok: z.string().optional(),
  description: z.string().optional(),
});

export type UpdateClubProfileInput = z.output<typeof updateClubProfileSchema>;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'Must be a hex color like #6366f1')
  .transform((v) => v.toLowerCase());

export const updateBrandingSchema = z.object({
  brandPrimaryColor: hexColor.optional(),
  brandSecondaryColor: hexColor.optional(),
  logoUrl: z.string().url().nullable().optional().or(z.literal('')),
  coverPhotoUrl: z.string().url().nullable().optional().or(z.literal('')),
  faviconUrl: z.string().url().nullable().optional().or(z.literal('')),
});

export type UpdateBrandingInput = z.output<typeof updateBrandingSchema>;

const notificationChannel = z.object({ email: z.boolean() });

export const updateNotificationsSchema = z.object({
  notificationPreferences: z.object({
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
  }),
});

export type UpdateNotificationsInput = z.output<typeof updateNotificationsSchema>;

export const updateDiscoverySchema = z.object({
  isPublicListing: z.boolean().optional(),
  // Only two modes: open (public, instant join) or invite_only (private).
  // Legacy 'approval' values coming from old records are accepted for
  // backwards compatibility — the join endpoint treats them as invite_only.
  joinPolicy: z.enum(['open', 'invite_only', 'approval']).optional(),
  shortDescription: z.string().max(280).nullable().optional(),
});

export type UpdateDiscoveryInput = z.output<typeof updateDiscoverySchema>;

export const updateBookingRulesSchema = z.object({
  advanceBookingDays: optionalNumeric(z.number().int().min(1).max(365)),
  bookingCutoffHours: optionalNumeric(z.number().int().min(0)),
  cancellationNoticeHours: optionalNumeric(z.number().int().min(0)),
  defaultLessonDurationMinutes: optionalNumeric(z.number().int().min(15)),
  allowOverbooking: z.boolean().optional(),
  overbookingLimit: optionalNumeric(z.number().int().min(0)),
  defaultCalendarView: z.enum(['day', 'week', 'month', 'agenda']).optional(),
  lateCancellationFeePercent: optionalNumeric(z.number().min(0).max(100)),
  noShowFeePercent: optionalNumeric(z.number().min(0).max(100)),
});

export type UpdateBookingRulesInput = z.output<typeof updateBookingRulesSchema>;

// ─── Staff ────────────────────────────────────────────────────────────

export const createStaffSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
  email: z.string().email().max(255),
  phone: z.string().max(50).optional(),
  role: z.enum(['club_manager', 'coach', 'groom']),
});

export type CreateStaffInput = z.output<typeof createStaffSchema>;

export const updateStaffSchema = createStaffSchema.partial();
export type UpdateStaffInput = z.output<typeof updateStaffSchema>;

export const staffFiltersSchema = z.object({
  search: z.string().optional(),
  role: z.string().optional(),
  ...paginationSchema.shape,
});

// ─── Owners ───────────────────────────────────────────────────────────

export const createOwnerSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(255),
  email: z.string().email().max(255),
  phone: z.string().max(50).optional(),
});

export type CreateOwnerInput = z.output<typeof createOwnerSchema>;

// ─── Finances ─────────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  description: z.string().min(1),
  amount: numericField(z.number().positive()),
  currency: z.string().length(3).default('AED'),
  date: z.string().min(1, 'Date is required'),
  horseId: z.string().uuid().optional(),
  vendorName: z.string().max(255).optional(),
});

export type CreateExpenseFormValues = z.input<typeof createExpenseSchema>;
export type CreateExpenseInput = z.output<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateExpenseFormValues = z.input<typeof updateExpenseSchema>;
export type UpdateExpenseInput = z.output<typeof updateExpenseSchema>;

export const expenseFiltersSchema = z.object({
  category: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ...paginationSchema.shape,
});

export const createCouponSchema = z.object({
  code: z.string().min(1).max(50).transform((v) => v.toUpperCase()),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: numericField(z.number().positive()),
  maxDiscount: optionalNumeric(z.number().positive()),
  minimumAmount: optionalNumeric(z.number().int()),
  maxUses: optionalNumeric(z.number().int().positive()),
  maxUsesPerRider: optionalNumeric(z.number().int().positive()),
  firstTimeOnly: z.boolean().default(false),
  isStackable: z.boolean().default(false),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type CreateCouponFormValues = z.input<typeof createCouponSchema>;
export type CreateCouponInput = z.output<typeof createCouponSchema>;

// ─── Horse Health ─────────────────────────────────────────────────────

const HEALTH_RECORD_TYPES = [
  'vaccination', 'vet_visit', 'dental', 'deworming', 'blood_test',
  'injury', 'condition', 'allergy', 'farrier', 'other',
] as const;

export const createHealthRecordSchema = z.object({
  recordType: z.string().min(1).max(50),
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  nextDueDate: z.string().optional(),
  vetName: z.string().max(255).optional(),
  vetClinic: z.string().max(255).optional(),
  diagnosis: z.string().optional(),
  treatment: z.string().optional(),
  cost: optionalNumeric(z.number().int().min(0)),
  recoveryTimeDays: optionalNumeric(z.number().int().min(0)),
  followUpNeeded: z.boolean().default(false),
  followUpDate: z.string().optional(),
  batchNumber: z.string().max(100).optional(),
  productUsed: z.string().max(255).optional(),
  documentUrls: z.array(z.string().url()).optional(),
});

export type CreateHealthRecordFormValues = z.input<typeof createHealthRecordSchema>;
export type CreateHealthRecordInput = z.output<typeof createHealthRecordSchema>;

export const createMedicationSchema = z.object({
  medicationName: z.string().min(1, 'Medication name is required').max(255),
  dosage: z.string().min(1, 'Dosage is required').max(100),
  frequency: z.string().min(1, 'Frequency is required').max(100),
  timeOfDay: z.array(z.string()).optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  isActive: z.boolean().default(true),
  prescribedBy: z.string().max(255).optional(),
  notes: z.string().optional(),
});

export type CreateMedicationInput = z.output<typeof createMedicationSchema>;
export const updateMedicationSchema = createMedicationSchema.partial();

export const createMedicationLogSchema = z.object({
  medicationId: z.string().uuid(),
  administeredAt: z.string().min(1),
  administeredByMemberId: z.string().uuid().optional(),
  wasAdministered: z.boolean().default(true),
  skipReason: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateMedicationLogInput = z.output<typeof createMedicationLogSchema>;

export const createFeedingPlanSchema = z.object({
  mealName: z.string().min(1, 'Meal name is required').max(100),
  feedType: z.string().max(255).optional(),
  quantityKg: optionalNumeric(z.number().positive()),
  supplements: z.array(z.string()).optional(),
  notes: z.string().optional(),
  timeOfDay: z.string().optional(),
});

export type CreateFeedingPlanFormValues = z.input<typeof createFeedingPlanSchema>;
export type CreateFeedingPlanInput = z.output<typeof createFeedingPlanSchema>;
export const updateFeedingPlanSchema = createFeedingPlanSchema.partial();

export const createExerciseScheduleSchema = z.object({
  dayOfWeek: numericField(z.number().int().min(0).max(6)),
  exerciseType: z.string().min(1, 'Exercise type is required').max(100),
  durationMinutes: optionalNumeric(z.number().int().positive()),
  intensity: z.string().max(20).optional(),
  notes: z.string().optional(),
});

export type CreateExerciseScheduleFormValues = z.input<typeof createExerciseScheduleSchema>;
export type CreateExerciseScheduleInput = z.output<typeof createExerciseScheduleSchema>;
export const updateExerciseScheduleSchema = createExerciseScheduleSchema.partial();

const FILE_CATEGORIES = [
  'medical_report', 'blood_test', 'xray', 'competition_result',
  'registration', 'insurance', 'purchase_agreement', 'vaccination_certificate', 'other',
] as const;

export const createDocumentSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255),
  fileUrl: z.string().url('Valid URL required'),
  fileSizeBytes: optionalNumeric(z.number().int().positive()),
  fileType: z.string().max(50).optional(),
  category: z.enum(FILE_CATEGORIES).default('other'),
  description: z.string().optional(),
});

export type CreateDocumentInput = z.output<typeof createDocumentSchema>;
