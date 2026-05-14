// Audit 2026-05-13 (P1): shared date/time formatters for booking emails so
// reminder/cancellation no longer ship raw `2026-05-13` and `09:00:00` while
// confirmation shows formatted output. Each template's caller passes a
// `YYYY-MM-DD` date string and an `HH:MM` (or `HH:MM:SS`) time string —
// these helpers turn them into "Monday, March 31, 2026" and "9:00 AM" with
// the same `Intl.toLocaleDateString` parameters in every booking email.

/**
 * "2026-03-31" → "Monday, March 31, 2026". Returns the input string
 * unchanged if it doesn't parse as a date, so a template never renders
 * "Invalid Date".
 */
export function formatBookingDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * "09:00:00" or "09:00" → "9:00 AM". Returns the input string unchanged
 * if it doesn't parse, so a template never renders "NaN".
 */
export function formatBookingTime(time: string): string {
  const parts = time.split(':');
  const hours = parseInt(parts[0] ?? '', 10);
  const minutes = parts[1] ?? '00';
  if (isNaN(hours)) return time;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}
