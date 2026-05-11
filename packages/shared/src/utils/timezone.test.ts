import { describe, it, expect } from 'vitest';
import { parseDateTimeLocal, getTodayDateString, isDateInPast } from './timezone';

describe('parseDateTimeLocal', () => {
  it('converts Dubai time to correct UTC', () => {
    // 10:00 in Asia/Dubai (UTC+4) should be 06:00 UTC
    const result = parseDateTimeLocal('2026-04-01T10:00', 'Asia/Dubai');
    expect(result.toISOString()).toBe('2026-04-01T06:00:00.000Z');
  });

  it('converts midnight Dubai to previous day UTC', () => {
    // 00:00 in Asia/Dubai (UTC+4) should be 20:00 UTC previous day
    const result = parseDateTimeLocal('2026-04-01T00:00', 'Asia/Dubai');
    expect(result.toISOString()).toBe('2026-03-31T20:00:00.000Z');
  });

  it('handles UTC timezone (no offset)', () => {
    const result = parseDateTimeLocal('2026-04-01T10:00', 'UTC');
    expect(result.toISOString()).toBe('2026-04-01T10:00:00.000Z');
  });

  it('handles seconds in the input', () => {
    const result = parseDateTimeLocal('2026-04-01T10:30:45', 'Asia/Dubai');
    expect(result.toISOString()).toBe('2026-04-01T06:30:45.000Z');
  });

  it('handles US Eastern timezone', () => {
    // 10:00 in America/New_York (UTC-4 in April, EDT) should be 14:00 UTC
    const result = parseDateTimeLocal('2026-04-01T10:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-04-01T14:00:00.000Z');
  });

  it('throws on invalid format', () => {
    expect(() => parseDateTimeLocal('not-a-date', 'Asia/Dubai')).toThrow(
      'Invalid datetime-local format',
    );
  });

  it('throws on date-only string', () => {
    expect(() => parseDateTimeLocal('2026-04-01', 'Asia/Dubai')).toThrow(
      'Invalid datetime-local format',
    );
  });

  // ─── DST boundaries ──────────────────────────────────────────────────
  // The GCC (Asia/Dubai, Asia/Riyadh, etc.) doesn't observe DST so most of
  // the production traffic never hits these transitions. But the function
  // is also used by clubs configured to e.g. Europe/London or
  // America/New_York, where bookings spanning the transition would
  // otherwise drift by an hour. These tests pin the conversion at both
  // sides of the spring-forward and fall-back jumps.

  describe('DST transitions', () => {
    it('handles US Eastern spring-forward (2026-03-08 02:00 → 03:00)', () => {
      // The hour 02:00–02:59 doesn't exist on this date — it gets skipped.
      // 01:30 EST is UTC-5 → 06:30 UTC.
      expect(parseDateTimeLocal('2026-03-08T01:30', 'America/New_York').toISOString()).toBe(
        '2026-03-08T06:30:00.000Z',
      );
      // 03:30 EDT is UTC-4 → 07:30 UTC (clock has jumped forward).
      expect(parseDateTimeLocal('2026-03-08T03:30', 'America/New_York').toISOString()).toBe(
        '2026-03-08T07:30:00.000Z',
      );
    });

    it('handles US Eastern fall-back (2026-11-01 02:00 → 01:00)', () => {
      // The hour 01:00–01:59 occurs twice. Local-time inputs are
      // ambiguous; date-fns/tz resolves them to the first occurrence (DST,
      // UTC-4). We pin that behaviour rather than relying on the
      // implementation-defined choice.
      expect(parseDateTimeLocal('2026-11-01T00:30', 'America/New_York').toISOString()).toBe(
        '2026-11-01T04:30:00.000Z',
      );
      // 03:30 EST (after the second 01:30) is UTC-5 → 08:30 UTC.
      expect(parseDateTimeLocal('2026-11-01T03:30', 'America/New_York').toISOString()).toBe(
        '2026-11-01T08:30:00.000Z',
      );
    });

    it('handles Europe/London spring-forward (2026-03-29 01:00 → 02:00)', () => {
      // 00:30 GMT is UTC → 00:30 UTC.
      expect(parseDateTimeLocal('2026-03-29T00:30', 'Europe/London').toISOString()).toBe(
        '2026-03-29T00:30:00.000Z',
      );
      // 02:30 BST is UTC+1 → 01:30 UTC (clock skipped 01:00–01:59).
      expect(parseDateTimeLocal('2026-03-29T02:30', 'Europe/London').toISOString()).toBe(
        '2026-03-29T01:30:00.000Z',
      );
    });

    it('handles Europe/London fall-back (2026-10-25 02:00 → 01:00)', () => {
      // 00:30 BST (UTC+1) → 23:30 UTC previous day.
      expect(parseDateTimeLocal('2026-10-25T00:30', 'Europe/London').toISOString()).toBe(
        '2026-10-24T23:30:00.000Z',
      );
      // 03:30 GMT (after second 01:30) → 03:30 UTC.
      expect(parseDateTimeLocal('2026-10-25T03:30', 'Europe/London').toISOString()).toBe(
        '2026-10-25T03:30:00.000Z',
      );
    });

    it('Asia/Dubai stays at UTC+4 across all of 2026 (no DST)', () => {
      // Dubai doesn't observe DST. These would be transition windows in
      // other zones — Dubai stays put.
      expect(parseDateTimeLocal('2026-03-29T02:30', 'Asia/Dubai').toISOString()).toBe(
        '2026-03-28T22:30:00.000Z',
      );
      expect(parseDateTimeLocal('2026-10-25T02:30', 'Asia/Dubai').toISOString()).toBe(
        '2026-10-24T22:30:00.000Z',
      );
    });
  });
});

describe('getTodayDateString', () => {
  it('returns a YYYY-MM-DD string', () => {
    const result = getTodayDateString('Asia/Dubai');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isDateInPast', () => {
  it('returns true for a past date', () => {
    expect(isDateInPast('2020-01-01', 'Asia/Dubai')).toBe(true);
  });

  it('returns false for a future date', () => {
    expect(isDateInPast('2099-12-31', 'Asia/Dubai')).toBe(false);
  });
});
