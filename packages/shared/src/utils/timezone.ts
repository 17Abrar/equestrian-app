import { TZDate } from '@date-fns/tz';
import { startOfDay, endOfDay, format } from 'date-fns';

/**
 * Returns "today" as a YYYY-MM-DD string in the given timezone.
 * Use for queries against Postgres `date` columns.
 */
export function getTodayDateString(timezone: string): string {
  const nowInTz = new TZDate(new Date(), timezone);
  return format(nowInTz, 'yyyy-MM-dd');
}

/**
 * Returns "today" as a YYYY-MM-DD string in the BROWSER / device local
 * timezone. Use for default values on date-input controls where the user
 * naturally expects "today by my watch", not "today in UTC".
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC date and is
 * subtly wrong in any non-UTC timezone — in Dubai (UTC+4) at 02:00 local,
 * it returns yesterday-UTC, so a "today" default lands on yesterday.
 */
export function getTodayLocalDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns UTC start/end boundaries for "today" in the given timezone.
 * Use for range queries on `timestamptz` columns.
 */
export function getTodayBoundsUTC(timezone: string): { start: Date; end: Date } {
  const nowInTz = new TZDate(new Date(), timezone);
  return {
    start: new Date(startOfDay(nowInTz).toISOString()),
    end: new Date(endOfDay(nowInTz).toISOString()),
  };
}

/**
 * Checks whether a date string (YYYY-MM-DD) is in the past relative to the given timezone.
 */
export function isDateInPast(dateStr: string, timezone: string): boolean {
  const today = getTodayDateString(timezone);
  return dateStr < today;
}

/**
 * Interprets a datetime-local input value (e.g. "2026-04-01T10:00") as being in the
 * specified timezone and returns the correct UTC Date.
 *
 * HTML `<input type="datetime-local">` emits strings without timezone info.
 * `new Date('2026-04-01T10:00')` parses as server-local time (UTC on Vercel),
 * which is wrong if the admin is in Asia/Dubai. This function fixes that.
 *
 * Example: parseDateTimeLocal("2026-04-01T10:00", "Asia/Dubai")
 *   → Date representing 2026-04-01T06:00:00Z (10:00 Dubai = 06:00 UTC)
 */
export function parseDateTimeLocal(value: string, timezone: string): Date {
  // Parse the components from the datetime-local format "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new Error(`Invalid datetime-local format: "${value}". Expected YYYY-MM-DDTHH:MM`);
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // TZDate uses 0-indexed months
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr ?? '0');

  // TZDate constructor interprets these components as being in the given timezone
  const tzDate = new TZDate(year, month, day, hour, minute, second, timezone);

  // Convert to a plain UTC Date
  return new Date(tzDate.toISOString());
}
