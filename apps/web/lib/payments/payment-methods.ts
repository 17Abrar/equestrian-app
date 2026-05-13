import {
  BOOKING_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@equestrian/shared/types';

export const OFFLINE_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>([
  PAYMENT_METHOD.Cash,
  PAYMENT_METHOD.CardInPerson,
  PAYMENT_METHOD.BankTransfer,
  PAYMENT_METHOD.PackageCredit,
]);

const PAYABLE_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  PAYMENT_STATUS.Pending,
  PAYMENT_STATUS.Failed,
  PAYMENT_STATUS.Overdue,
]);

interface BookingPaymentState {
  amount: number | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  status: BookingStatus;
}

export function isOfflinePaymentMethod(method: PaymentMethod | null | undefined): boolean {
  return method != null && OFFLINE_PAYMENT_METHODS.has(method);
}

export function isBookingPaymentActionRequired(booking: BookingPaymentState): boolean {
  if (booking.amount == null || booking.amount <= 0) return false;
  if (isOfflinePaymentMethod(booking.paymentMethod)) return false;
  if (
    booking.status === BOOKING_STATUS.Cancelled ||
    booking.status === BOOKING_STATUS.Completed ||
    booking.status === BOOKING_STATUS.NoShow
  ) {
    return false;
  }
  return PAYABLE_PAYMENT_STATUSES.has(booking.paymentStatus);
}
