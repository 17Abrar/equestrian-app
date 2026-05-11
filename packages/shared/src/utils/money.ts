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
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'PYG',
  'RWF',
  'UGX',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

// Cache Intl probes so a hot path doesn't pay the constructor cost per
// call. Map values are 0/2/3 (or null for "Intl rejects this code, fall
// back to 2").
const intlDecimalCache = new Map<string, number | null>();

function decimalsFromIntl(upper: string): number | null {
  if (intlDecimalCache.has(upper)) return intlDecimalCache.get(upper) ?? null;
  let result: number | null;
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: upper });
    const min = fmt.resolvedOptions().minimumFractionDigits;
    result = typeof min === 'number' ? min : null;
  } catch {
    // Currency code Intl doesn't recognize — return null so the caller
    // falls back to the safe 2-decimal default.
    result = null;
  }
  intlDecimalCache.set(upper, result);
  return result;
}

function currencyDecimals(currency: string): number {
  const upper = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
  // Audit B-20: defer to Intl.NumberFormat for currencies the explicit
  // sets don't cover (e.g. BIF, GNF, ISK are 0-decimal but only become
  // relevant if a club ever picks them). Still falls back to 2 if Intl
  // rejects the code so the previous behaviour is preserved.
  const intl = decimalsFromIntl(upper);
  if (intl !== null) return intl;
  return 2;
}

/**
 * Converts a user-entered amount in major currency units (e.g., AED dirhams)
 * to the smallest unit (fils/cents) for database storage.
 *
 * The currency arg is required because 0/2/3-decimal currencies have
 * different scales — passing `1.5 KWD` without it would produce 150 minor
 * units (treating KWD as 2-decimal) instead of the correct 1500.
 *
 * Rounds via Math.round to avoid floating-point representation drift.
 */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * Math.pow(10, currencyDecimals(currency)));
}

/**
 * Converts a stored amount in smallest units back to major units for editing
 * in forms. Inverse of `toMinorUnits` — currency arg required for the same
 * reason.
 */
export function toMajorUnits(amount: number, currency: string): number {
  return amount / Math.pow(10, currencyDecimals(currency));
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
  const decimals = currencyDecimals(currency);
  const major = amountMinor / Math.pow(10, decimals);

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
