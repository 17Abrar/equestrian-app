import { describe, it, expect } from 'vitest';
import { calculateCouponDiscount } from './coupon-discount';

describe('calculateCouponDiscount — percentage path', () => {
  it('33% off a round amount rounds half-up (Math.round)', () => {
    // 100 fils * 0.33 = 33 fils
    expect(
      calculateCouponDiscount({ amount: 100, discountType: 'percentage', discountValue: 33 }),
    ).toBe(33);
  });

  it('50% off splits cleanly', () => {
    expect(
      calculateCouponDiscount({ amount: 25000, discountType: 'percentage', discountValue: 50 }),
    ).toBe(12500);
  });

  it('100% off equals the order total', () => {
    expect(
      calculateCouponDiscount({ amount: 12345, discountType: 'percentage', discountValue: 100 }),
    ).toBe(12345);
  });

  it('rounds half-away-from-zero at the half-fil boundary (.5 → up)', () => {
    // 1 fil * 0.5 = 0.5 → 1 (Math.round)
    expect(
      calculateCouponDiscount({ amount: 1, discountType: 'percentage', discountValue: 50 }),
    ).toBe(1);
  });

  it('honours maxDiscount when the % calc exceeds it', () => {
    // 50% of 10,000 fils = 5,000; cap pulls it down to 1,000
    expect(
      calculateCouponDiscount({
        amount: 10_000,
        discountType: 'percentage',
        discountValue: 50,
        maxDiscount: 1_000,
      }),
    ).toBe(1_000);
  });

  it('does not raise discount when % calc is below maxDiscount', () => {
    // 10% of 10,000 = 1,000; cap of 5,000 doesn't bite
    expect(
      calculateCouponDiscount({
        amount: 10_000,
        discountType: 'percentage',
        discountValue: 10,
        maxDiscount: 5_000,
      }),
    ).toBe(1_000);
  });

  it('caps discount at the order total even when percent calc would exceed', () => {
    // 200% (mis-configured coupon) clamps to amount
    expect(
      calculateCouponDiscount({ amount: 100, discountType: 'percentage', discountValue: 200 }),
    ).toBe(100);
  });
});

describe('calculateCouponDiscount — fixed path', () => {
  it('returns the literal discountValue when below order total', () => {
    expect(
      calculateCouponDiscount({ amount: 10_000, discountType: 'fixed', discountValue: 500 }),
    ).toBe(500);
  });

  it('clamps to the order total when discountValue exceeds it', () => {
    expect(
      calculateCouponDiscount({ amount: 100, discountType: 'fixed', discountValue: 500 }),
    ).toBe(100);
  });

  it('ignores maxDiscount on fixed-type coupons (intentional — caller policy)', () => {
    // maxDiscount is documented as a percentage-path cap; the fixed path
    // returns discountValue verbatim. The order-total cap still applies.
    expect(
      calculateCouponDiscount({
        amount: 5_000,
        discountType: 'fixed',
        discountValue: 1_000,
        maxDiscount: 500,
      }),
    ).toBe(1_000);
  });
});
