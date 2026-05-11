import { parseDateTimeLocal } from './timezone';
import { MS_PER_HOUR } from '../constants';

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

  // Audit r5 F-59 (2026-05-07): use the shared MS_PER_HOUR constant.
  const hoursUntilSlot = (slotEpoch - nowEpoch) / MS_PER_HOUR;

  // Cutoff is cancellationNoticeHours before the slot start
  const cutoffEpoch = slotEpoch - cancellationNoticeHours * MS_PER_HOUR;
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

/**
 * Audit F-59 (2026-05-08 r6): Drizzle's `numeric` columns return strings
 * (`'2.50'`), and the prior consumer pattern of `Number(value)` silently
 * produced `NaN` for malformed input — which `calculateNoShowFee` /
 * `calculateCancellationFee` then propagated through the math, surfacing
 * as a `NaN` fee instead of a 500.
 *
 * `clubs.lateCancellationFeePercent` and `clubs.noShowFeePercent` are the
 * two cited columns; the writer (`updateBookingRulesSchema`) constrains
 * to [0, 100] so the read contract is "string in [0,100]". This helper
 * enforces it.
 *
 * Throws when the input is null/undefined (caller must decide the default
 * — typically 0) or when parsing produces NaN/out-of-range. Callers that
 * want the "missing means zero" behavior should pass `value ?? '0'`.
 */
export function coerceFeePercent(value: string | number, columnName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`coerceFeePercent: ${columnName} parsed to NaN from ${JSON.stringify(value)}`);
  }
  if (parsed < 0 || parsed > 100) {
    throw new Error(`coerceFeePercent: ${columnName}=${parsed} out of range [0, 100]`);
  }
  return parsed;
}
