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

/**
 * Maps currency codes to the locale that produces the most natural grouping
 * for that currency. Values default to "en-{country}" which Intl recognizes
 * and which produces ASCII digits + Western thousands separators — safer in
 * emails than locales that include RTL markers or non-Latin digits.
 */
const CURRENCY_LOCALE: Record<string, string> = {
  AED: 'en-AE',
  SAR: 'en-SA',
  KWD: 'en-KW',
  BHD: 'en-BH',
  QAR: 'en-QA',
  OMR: 'en-OM',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
  CAD: 'en-CA',
  AUD: 'en-AU',
};

/**
 * Zero-decimal currencies per ISO 4217 that Stripe also treats as
 * zero-decimal. JOD / KWD / OMR / BHD / TND are 3-decimal (minor units in
 * thousandths). We don't actively support those pricing models yet — the
 * DB stores `_minor_units` meaning cents for 2-decimal currencies — but
 * listing here lets the formatter at least render the right fraction count
 * if a 3-decimal club is ever onboarded.
 */
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/**
 * Display-ready money formatter. Pass the stored minor-unit integer + ISO
 * currency code; picks a sensible locale and fraction-digit count.
 *
 * Used by email templates, invoice lists, and any UI that displays stored
 * amounts. Keeps the locale decision in one place so a future non-AED club
 * doesn't produce mixed formatting across the app.
 *
 * Examples:
 *   formatCurrency(250000, 'AED') → "AED 2,500.00"
 *   formatCurrency(250000, 'USD') → "USD 2,500.00"
 *   formatCurrency(5000,   'JPY') → "JPY 5,000"
 */
export function formatCurrency(amountMinor: number, currency: string): string {
  const upper = currency.toUpperCase();
  const locale = CURRENCY_LOCALE[upper] ?? 'en-US';

  let decimals = 2;
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) decimals = 0;
  else if (THREE_DECIMAL_CURRENCIES.has(upper)) decimals = 3;

  const divisor = Math.pow(10, decimals);
  const major = amountMinor / divisor;

  const numberText = major.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${upper} ${numberText}`;
}
