/**
 * Converts a user-entered amount in major currency units (e.g., AED dirhams)
 * to the smallest unit (fils/cents) for database storage.
 * Rounds to avoid floating-point issues.
 */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Converts a stored amount in smallest units (fils/cents)
 * to major currency units (dirhams/dollars) for display.
 */
export function toMajorUnits(amount: number): number {
  return amount / 100;
}

/**
 * Formats a stored amount (in smallest units) as a display string.
 * Example: formatMoney(15000, 'AED') → "150.00 AED"
 */
export function formatMoney(amountMinor: number, currency: string): string {
  return `${toMajorUnits(amountMinor).toFixed(2)} ${currency}`;
}
