import { pgEnum } from 'drizzle-orm/pg-core';

export const horseStatusEnum = pgEnum('horse_status', [
  'available',
  'resting',
  'injured',
  'retired',
  'off_site',
  'sold',
]);

export const skillLevelEnum = pgEnum('skill_level', [
  'beginner',
  'intermediate',
  'advanced',
]);

export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'partial',
  'refunded',
  'failed',
  'overdue',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'card',
  'apple_pay',
  'google_pay',
  'tabby',
  'tamara',
  'knet',
  'mada',
  'benefit',
  'cash',
  'card_in_person',
  'package_credit',
  'bank_transfer',
]);

export const userRoleEnum = pgEnum('user_role', [
  'club_admin',
  'club_manager',
  'coach',
  'horse_owner',
  'rider',
  'parent',
  'groom',
  'veterinarian',
]);

export const liveryTypeEnum = pgEnum('livery_type', ['full', 'part', 'diy']);

export const couponStatusEnum = pgEnum('coupon_status', [
  'active',
  'paused',
  'expired',
  'exhausted',
]);

export const couponDiscountTypeEnum = pgEnum('coupon_discount_type', [
  'percentage',
  'fixed',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'sent',
  'paid',
  'overdue',
  'void',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'cancelled',
  'trialing',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

export const postTypeEnum = pgEnum('post_type', [
  'discussion',
  'photo',
  'video',
  'poll',
]);

export const fileCategoryEnum = pgEnum('file_category', [
  'medical_report',
  'blood_test',
  'xray',
  'competition_result',
  'registration',
  'insurance',
  'purchase_agreement',
  'vaccination_certificate',
  'other',
]);

export const horseSaleStatusEnum = pgEnum('horse_sale_status', [
  'not_for_sale',
  'for_sale',
  'sold',
]);

export const ownershipStatusEnum = pgEnum('ownership_status', [
  'pending',
  'active',
  'retired',
  'declined',
]);

export const liveryInvoiceStatusEnum = pgEnum('livery_invoice_status', [
  'pending',
  'paid',
  'overdue',
  'cancelled',
]);

export const paymentProviderEnum = pgEnum('payment_provider', [
  'stripe',
  'n_genius',
  'ziina',
]);

export const paymentAccountStatusEnum = pgEnum('payment_account_status', [
  'pending',
  'connected',
  'disabled',
  'error',
]);
