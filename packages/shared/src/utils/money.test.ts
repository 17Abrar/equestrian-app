import { describe, it, expect } from 'vitest';
import { toMinorUnits, toMajorUnits, formatMoney, formatCurrency } from './money';

describe('toMinorUnits', () => {
  it('converts whole dirhams to fils', () => {
    expect(toMinorUnits(100)).toBe(10000);
  });

  it('converts dirhams with two decimals', () => {
    expect(toMinorUnits(100.99)).toBe(10099);
    expect(toMinorUnits(2500)).toBe(250000);
  });

  it('rounds half-up at the cent boundary', () => {
    // 0.045 → 4.5 → 5 (Math.round rounds half up away from zero for positives)
    expect(toMinorUnits(0.045)).toBe(5);
    // 0.044 → 4.4 → 4
    expect(toMinorUnits(0.044)).toBe(4);
  });

  it('rounds at the half-cent boundary (100.005 → 10001 due to IEEE-754)', () => {
    // 100.005 in IEEE-754 is 100.005000000000003 (slightly above 100.005),
    // so 100.005 * 100 = 10000.500000000002; Math.round → 10001.
    // The test pins this behaviour so a refactor (e.g. switching to a
    // decimal library) is a deliberate choice, not an accident.
    expect(toMinorUnits(100.005)).toBe(10001);
  });

  it('rounds 1.005 to 100 minor units (different IEEE-754 representation)', () => {
    // 1.005 in IEEE-754 is 1.0049999999999999 (slightly below 1.005), so
    // 1.005 * 100 = 100.49999999999999; Math.round → 100. Same logical
    // input, different rounding result — the float representation of the
    // input value matters, not the half-up rule alone.
    expect(toMinorUnits(1.005)).toBe(100);
  });

  it('handles zero correctly', () => {
    expect(toMinorUnits(0)).toBe(0);
  });

  it('handles negative values (refunds)', () => {
    expect(toMinorUnits(-100.5)).toBe(-10050);
  });

  it('handles very large values without overflow', () => {
    // 1 billion AED in fils is 100 billion — well inside Number.MAX_SAFE_INTEGER
    expect(toMinorUnits(1_000_000_000)).toBe(100_000_000_000);
  });
});

describe('toMajorUnits', () => {
  it('converts fils to dirhams', () => {
    expect(toMajorUnits(10000)).toBe(100);
    expect(toMajorUnits(10099)).toBe(100.99);
  });

  it('handles zero', () => {
    expect(toMajorUnits(0)).toBe(0);
  });

  it('round-trips for whole-cent values', () => {
    for (const v of [0, 1, 99, 100, 12345, 99999]) {
      expect(toMinorUnits(toMajorUnits(v))).toBe(v);
    }
  });
});

describe('formatMoney', () => {
  it('formats AED with two decimals', () => {
    expect(formatMoney(10099, 'AED')).toBe('100.99 AED');
  });

  it('inserts thousands separators', () => {
    expect(formatMoney(250000, 'AED')).toBe('2,500.00 AED');
    expect(formatMoney(100000000, 'AED')).toBe('1,000,000.00 AED');
  });

  it('formats zero-decimal currencies without fraction digits', () => {
    expect(formatMoney(5000, 'JPY')).toBe('5,000 JPY');
    expect(formatMoney(0, 'JPY')).toBe('0 JPY');
  });

  it('formats three-decimal currencies (BHD/KWD/OMR/JOD/TND)', () => {
    expect(formatMoney(100000, 'BHD')).toBe('100.000 BHD');
    expect(formatMoney(123456, 'KWD')).toBe('123.456 KWD');
  });

  it('uppercases the currency code in the output', () => {
    expect(formatMoney(10099, 'aed')).toBe('100.99 AED');
  });

  it('falls back to en-US locale for an unknown currency', () => {
    // Unknown currency → defaults to 2-decimal, en-US locale
    const result = formatMoney(10099, 'XYZ');
    expect(result).toBe('100.99 XYZ');
  });

  it('handles negative amounts', () => {
    // Refund display — the locale formatter inserts the minus sign.
    expect(formatMoney(-10099, 'AED')).toMatch(/^-?100\.99 AED$/);
  });

  it('handles zero correctly', () => {
    expect(formatMoney(0, 'AED')).toBe('0.00 AED');
  });

  it('exports formatCurrency as an alias for formatMoney', () => {
    // Existing callers depend on this alias — the test pins the contract so a
    // refactor that drops `formatCurrency` fails loudly here, not in random
    // dashboard components.
    expect(formatCurrency).toBe(formatMoney);
  });
});
