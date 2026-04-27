import { formatMoney } from './money';

/**
 * Formats a `HH:MM` or `HH:MM:SS` 24h string into a 12h "h:MM AM/PM" display.
 * Used by every rider-facing booking surface — keep one canonical
 * implementation here so a future timezone fix doesn't have to chase five
 * copies in `apps/web/app/rider/`.
 *
 * Defensive on malformed input: missing/non-numeric parts default to 0
 * rather than producing `NaN` or undefined in the UI.
 */
export function formatTime(timeStr: string): string {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Renders a date in the rider's local zone using a configurable Intl style.
 * Accepts a `YYYY-MM-DD` string (the common shape — slot dates from the API)
 * or a `Date` (week-navigation cursors that are constructed in JS). The
 * string overload anchors to local-midnight via `T00:00:00` because
 * `new Date('2026-04-26')` would otherwise parse as UTC, which in
 * negative-offset zones flips the displayed weekday by a day.
 *
 * Default ("short") matches the home/list cards and the week navigator;
 * "long" matches the booking-detail header.
 */
export type DateFormatStyle = 'short' | 'long';

export function formatDate(value: string | Date, style: DateFormatStyle = 'short'): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value;
  const options: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Money formatter for rider-facing surfaces where the amount may be null
 * (no price set, or no override on the booking). Returns `'—'` for null
 * — matches the existing booking-detail UI; pass `''` via the second arg
 * for surfaces that prefer to render nothing.
 */
export function formatPrice(
  amountMinor: number | null,
  currency: string,
  emptyDisplay: string = '—',
): string {
  if (amountMinor == null) return emptyDisplay;
  return formatMoney(amountMinor, currency);
}
