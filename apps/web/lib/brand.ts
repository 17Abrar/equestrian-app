/**
 * Brand constants shared between CSS-land and JS-land.
 *
 * Audit DS-1 (2026-06-07): the brand navy used to live as the raw literal
 * `#0d1f34` in six places (five landing className spots plus the Clerk
 * appearance object). The CSS usages now read the `--color-brand` token in
 * app/globals.css; this constant exists for the JS contexts that cannot use
 * a Tailwind utility, namely the Clerk `appearance.variables` object.
 *
 * Keep this value in sync with `--color-brand` in app/globals.css.
 */
export const BRAND_NAVY = '#0d1f34';
