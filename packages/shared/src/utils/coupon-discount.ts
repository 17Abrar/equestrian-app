/**
 * Pure helper for the discount-amount portion of `validateCoupon`. Kept
 * separate from the DB-bound query so the math invariants (percent
 * arithmetic, maxDiscount cap, order-total cap) can be unit-tested
 * without spinning up pglite — see audit B-17.
 *
 * Both the order amount and the returned discount are in minor currency
 * units (fils for AED). Percentage `discountValue` is integer 0–100 (33
 * means 33% off). Fixed `discountValue` is in minor units.
 */
export interface CouponDiscountInput {
  amount: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  maxDiscount?: number | null;
}

export function calculateCouponDiscount(input: CouponDiscountInput): number {
  let discount: number;
  if (input.discountType === 'percentage') {
    discount = Math.round(input.amount * (input.discountValue / 100));
    if (input.maxDiscount != null) {
      discount = Math.min(discount, input.maxDiscount);
    }
  } else {
    discount = input.discountValue;
  }
  // Discount cannot exceed the order total (refunding more than was
  // charged would invert the ledger).
  return Math.min(discount, input.amount);
}
