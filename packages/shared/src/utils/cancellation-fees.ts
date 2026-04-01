import { parseDateTimeLocal } from './timezone';

export interface CancellationFeeParams {
  /** Slot date in YYYY-MM-DD format */
  slotDate: string;
  /** Slot start time in HH:MM or HH:MM:SS format */
  slotStartTime: string;
  /** Club IANA timezone (e.g. "Asia/Dubai") */
  timezone: string;
  /** Hours of notice required for free cancellation */
  cancellationNoticeHours: number;
  /** Percentage of lesson price charged for late cancellations (0–100) */
  lateCancellationFeePercent: number;
  /** Lesson price in minor currency units (e.g. fils) */
  lessonPrice: number;
}

export interface CancellationFeeResult {
  /** Whether this cancellation is past the free-cancellation cutoff */
  isLate: boolean;
  /** Fee amount in minor currency units */
  fee: number;
  /** ISO string of the cutoff datetime (cancel before this to avoid a fee) */
  cutoffTime: string;
  /** Hours remaining until the slot starts (can be negative if slot has passed) */
  hoursUntilSlot: number;
}

export interface NoShowFeeParams {
  /** Percentage of lesson price charged for no-shows (0–100) */
  noShowFeePercent: number;
  /** Lesson price in minor currency units */
  lessonPrice: number;
}

/**
 * Calculates the cancellation fee for a booking based on how close the
 * cancellation is to the slot's start time relative to the club's notice
 * window.
 *
 * All time comparisons are done in the club's local timezone via
 * `parseDateTimeLocal` (backed by @date-fns/tz) to avoid DST and
 * month-boundary bugs.
 */
export function calculateCancellationFee(params: CancellationFeeParams): CancellationFeeResult {
  const {
    slotDate,
    slotStartTime,
    timezone,
    cancellationNoticeHours,
    lateCancellationFeePercent,
    lessonPrice,
  } = params;

  // Normalize time to HH:MM:SS for parseDateTimeLocal
  const timeParts = slotStartTime.split(':');
  const hh = (timeParts[0] ?? '00').padStart(2, '0');
  const mm = (timeParts[1] ?? '00').padStart(2, '0');
  const ss = (timeParts[2] ?? '00').padStart(2, '0');
  const slotDateTimeStr = `${slotDate}T${hh}:${mm}:${ss}`;

  // Convert the slot's local datetime to a proper UTC epoch using the
  // club timezone. This correctly handles DST and month/year boundaries.
  const slotUtc = parseDateTimeLocal(slotDateTimeStr, timezone);
  const slotEpoch = slotUtc.getTime();
  const nowEpoch = Date.now();

  const hoursUntilSlot = (slotEpoch - nowEpoch) / (1000 * 60 * 60);

  // Cutoff is cancellationNoticeHours before the slot start
  const cutoffEpoch = slotEpoch - cancellationNoticeHours * 60 * 60 * 1000;
  const cutoffTime = new Date(cutoffEpoch).toISOString();

  const isLate = nowEpoch > cutoffEpoch;

  let fee = 0;
  if (isLate && lateCancellationFeePercent > 0) {
    // Round to nearest minor unit (fils/cents). Math.round is intentional —
    // neither favoring the club nor the rider.
    fee = Math.round((lessonPrice * lateCancellationFeePercent) / 100);
  }

  return { isLate, fee, cutoffTime, hoursUntilSlot };
}

/**
 * Calculates the no-show fee for a booking.
 */
export function calculateNoShowFee(params: NoShowFeeParams): number {
  const { noShowFeePercent, lessonPrice } = params;
  if (noShowFeePercent <= 0) return 0;
  return Math.round((lessonPrice * noShowFeePercent) / 100);
}
