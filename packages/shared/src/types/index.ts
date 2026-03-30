// API Response Types — used across web and mobile

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Enums — mirroring database enums for type safety

export const HORSE_STATUS = {
  Available: 'available',
  Resting: 'resting',
  Injured: 'injured',
  Retired: 'retired',
  OffSite: 'off_site',
  Sold: 'sold',
} as const;

export type HorseStatus = (typeof HORSE_STATUS)[keyof typeof HORSE_STATUS];

export const SKILL_LEVEL = {
  Beginner: 'beginner',
  Intermediate: 'intermediate',
  Advanced: 'advanced',
} as const;

export type SkillLevel = (typeof SKILL_LEVEL)[keyof typeof SKILL_LEVEL];

export const BOOKING_STATUS = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  Completed: 'completed',
  Cancelled: 'cancelled',
  NoShow: 'no_show',
} as const;

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

export const PAYMENT_STATUS = {
  Pending: 'pending',
  Paid: 'paid',
  Partial: 'partial',
  Refunded: 'refunded',
  Failed: 'failed',
  Overdue: 'overdue',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_METHOD = {
  Card: 'card',
  ApplePay: 'apple_pay',
  GooglePay: 'google_pay',
  Tabby: 'tabby',
  Tamara: 'tamara',
  Knet: 'knet',
  Mada: 'mada',
  Benefit: 'benefit',
  Cash: 'cash',
  CardInPerson: 'card_in_person',
  PackageCredit: 'package_credit',
  BankTransfer: 'bank_transfer',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/**
 * Suggested lesson type names shown as templates when creating a new type.
 * Clubs can use any name they want — these are just starting suggestions.
 */
export const DEFAULT_LESSON_TYPES = [
  'Group',
  'Semi-Private',
  'Private',
  'Desert Ride',
  'Beach Ride',
  'Endurance',
  'Camp',
  'Clinic',
] as const;

export const USER_ROLE = {
  ClubAdmin: 'club_admin',
  ClubManager: 'club_manager',
  Coach: 'coach',
  HorseOwner: 'horse_owner',
  Rider: 'rider',
  Parent: 'parent',
  Groom: 'groom',
  Veterinarian: 'veterinarian',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const LIVERY_TYPE = {
  Full: 'full',
  Part: 'part',
  Diy: 'diy',
} as const;

export type LiveryType = (typeof LIVERY_TYPE)[keyof typeof LIVERY_TYPE];

export const COUPON_STATUS = {
  Active: 'active',
  Paused: 'paused',
  Expired: 'expired',
  Exhausted: 'exhausted',
} as const;

export type CouponStatus = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];

export const COUPON_DISCOUNT_TYPE = {
  Percentage: 'percentage',
  Fixed: 'fixed',
} as const;

export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPE)[keyof typeof COUPON_DISCOUNT_TYPE];

export const INVOICE_STATUS = {
  Draft: 'draft',
  Sent: 'sent',
  Paid: 'paid',
  Overdue: 'overdue',
  Void: 'void',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const SUBSCRIPTION_STATUS = {
  Active: 'active',
  PastDue: 'past_due',
  Cancelled: 'cancelled',
  Trialing: 'trialing',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const TASK_STATUS = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Skipped: 'skipped',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const HORSE_SALE_STATUS = {
  NotForSale: 'not_for_sale',
  ForSale: 'for_sale',
  Sold: 'sold',
} as const;

export type HorseSaleStatus = (typeof HORSE_SALE_STATUS)[keyof typeof HORSE_SALE_STATUS];

export const FILE_CATEGORY = {
  MedicalReport: 'medical_report',
  BloodTest: 'blood_test',
  Xray: 'xray',
  CompetitionResult: 'competition_result',
  Registration: 'registration',
  Insurance: 'insurance',
  PurchaseAgreement: 'purchase_agreement',
  VaccinationCertificate: 'vaccination_certificate',
  Other: 'other',
} as const;

export type FileCategory = (typeof FILE_CATEGORY)[keyof typeof FILE_CATEGORY];

export const COMPETITION_STATUS = {
  Draft: 'draft',
  Published: 'published',
  InProgress: 'in_progress',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;

export type CompetitionStatus = (typeof COMPETITION_STATUS)[keyof typeof COMPETITION_STATUS];

export const COMPETITION_ENTRY_STATUS = {
  Registered: 'registered',
  Confirmed: 'confirmed',
  Withdrawn: 'withdrawn',
  Scratched: 'scratched',
} as const;

export type CompetitionEntryStatus = (typeof COMPETITION_ENTRY_STATUS)[keyof typeof COMPETITION_ENTRY_STATUS];

export const POST_TYPE = {
  Discussion: 'discussion',
  Photo: 'photo',
  Video: 'video',
  Poll: 'poll',
} as const;

export type PostType = (typeof POST_TYPE)[keyof typeof POST_TYPE];
