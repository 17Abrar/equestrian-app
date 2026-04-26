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
 * Currency fraction-digit overrides per ISO 4217.
 *
 *   THREE_DECIMAL_CURRENCIES  — minor unit is one-thousandth of major
 *                                (BHD, JOD, KWD, OMR, TND). Stored in the
 *                                DB as `_minor_units` integers exactly as
 *                                with 2-decimal currencies — `formatMoney`
 *                                divides by 1000 instead of 100 so the
 *                                display value matches the printed
 *                                banknote.
 *   ZERO_DECIMAL_CURRENCIES   — Stripe-defined zero-decimal (no fractional
 *                                unit). `_minor_units` already IS the
 *                                major-unit value; divisor stays 1.
 *
 * Anything outside both sets defaults to 2 decimals.
 */
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/**
 * Display-ready money formatter. The canonical way to render a stored
 * minor-unit integer. Produces a suffix-format string with thousands
 * separators and the right fraction-digit count for the currency.
 *
 * Examples:
 *   formatMoney(10099,  'AED') → "100.99 AED"
 *   formatMoney(250000, 'AED') → "2,500.00 AED"
 *   formatMoney(5000,   'JPY') → "5,000 JPY"
 *   formatMoney(100000, 'BHD') → "100.000 BHD"
 */
export function formatMoney(amountMinor: number, currency: string): string {
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

  return `${numberText} ${upper}`;
}

/**
 * Alias for `formatMoney`. Kept so existing callers keep compiling; prefer
 * `formatMoney` for new code.
 */
export const formatCurrency = formatMoney;
