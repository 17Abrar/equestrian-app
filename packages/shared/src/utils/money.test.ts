import { describe, it, expect } from 'vitest';
import { toMinorUnits, toMajorUnits, formatMoney, formatCurrency } from './money';

describe('toMinorUnits', () => {
  it('converts whole dirhams to fils for AED (2-decimal)', () => {
    expect(toMinorUnits(100, 'AED')).toBe(10000);
  });

  it('converts dirhams with two decimals', () => {
    expect(toMinorUnits(100.99, 'AED')).toBe(10099);
    expect(toMinorUnits(2500, 'AED')).toBe(250000);
  });

  it('rounds half-up at the cent boundary (AED)', () => {
    expect(toMinorUnits(0.045, 'AED')).toBe(5);
    expect(toMinorUnits(0.044, 'AED')).toBe(4);
  });

  it('rounds at the half-cent boundary (100.005 → 10001 due to IEEE-754)', () => {
    expect(toMinorUnits(100.005, 'AED')).toBe(10001);
  });

  it('rounds 1.005 to 100 minor units (different IEEE-754 representation)', () => {
    expect(toMinorUnits(1.005, 'AED')).toBe(100);
  });

  it('handles zero correctly', () => {
    expect(toMinorUnits(0, 'AED')).toBe(0);
  });

  it('handles negative values (refunds)', () => {
    expect(toMinorUnits(-100.5, 'AED')).toBe(-10050);
  });

  it('handles very large values without overflow', () => {
    expect(toMinorUnits(1_000_000_000, 'AED')).toBe(100_000_000_000);
  });

  it('uses 1000-scale for 3-decimal currencies (KWD/BHD/JOD/OMR/TND)', () => {
    expect(toMinorUnits(1, 'KWD')).toBe(1000);
    expect(toMinorUnits(1.5, 'KWD')).toBe(1500);
    expect(toMinorUnits(123.456, 'BHD')).toBe(123456);
    expect(toMinorUnits(0.001, 'OMR')).toBe(1);
  });

  it('uses 1-scale (no minor unit) for 0-decimal currencies (JPY/KRW)', () => {
    expect(toMinorUnits(5000, 'JPY')).toBe(5000);
    expect(toMinorUnits(1234, 'KRW')).toBe(1234);
    expect(toMinorUnits(0.5, 'JPY')).toBe(1); // rounded
  });

  it('treats unknown currency codes as 2-decimal', () => {
    expect(toMinorUnits(100, 'XYZ')).toBe(10000);
  });

  it('is case-insensitive on the currency code', () => {
    expect(toMinorUnits(1, 'kwd')).toBe(1000);
    expect(toMinorUnits(1, 'aed')).toBe(100);
  });
});

describe('toMajorUnits', () => {
  it('converts fils to dirhams for AED', () => {
    expect(toMajorUnits(10000, 'AED')).toBe(100);
    expect(toMajorUnits(10099, 'AED')).toBe(100.99);
  });

  it('handles zero', () => {
    expect(toMajorUnits(0, 'AED')).toBe(0);
  });

  it('round-trips for whole-cent AED values', () => {
    for (const v of [0, 1, 99, 100, 12345, 99999]) {
      expect(toMinorUnits(toMajorUnits(v, 'AED'), 'AED')).toBe(v);
    }
  });

  it('round-trips for KWD (3-decimal)', () => {
    for (const v of [0, 1, 1500, 123456]) {
      expect(toMinorUnits(toMajorUnits(v, 'KWD'), 'KWD')).toBe(v);
    }
  });

  it('round-trips for JPY (0-decimal)', () => {
    for (const v of [0, 1, 5000, 999999]) {
      expect(toMinorUnits(toMajorUnits(v, 'JPY'), 'JPY')).toBe(v);
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
    const result = formatMoney(10099, 'XYZ');
    expect(result).toBe('100.99 XYZ');
  });

  it('handles negative amounts', () => {
    expect(formatMoney(-10099, 'AED')).toMatch(/^-?100\.99 AED$/);
  });

  it('handles zero correctly', () => {
    expect(formatMoney(0, 'AED')).toBe('0.00 AED');
  });

  it('exports formatCurrency as an alias for formatMoney', () => {
    expect(formatCurrency).toBe(formatMoney);
  });
});
