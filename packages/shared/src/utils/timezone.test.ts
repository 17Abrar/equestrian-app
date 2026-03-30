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
    expect(() => parseDateTimeLocal('not-a-date', 'Asia/Dubai')).toThrow('Invalid datetime-local format');
  });

  it('throws on date-only string', () => {
    expect(() => parseDateTimeLocal('2026-04-01', 'Asia/Dubai')).toThrow('Invalid datetime-local format');
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
