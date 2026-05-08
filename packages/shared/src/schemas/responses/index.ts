/**
 * Audit F-69 companion (2026-05-08 r6): per-route response schemas for
 * the api-client's `validate:` parameter. Adding a new endpoint:
 *
 *   1. Define the schema next to its sibling route (horses.ts,
 *      bookings.ts, etc.). Keep the union literals in sync with
 *      `packages/db/src/schema/enums.ts` — that's authoritative.
 *   2. Re-export it from this barrel so consumers only import from
 *      `@equestrian/shared/schemas/responses`.
 *   3. Wire it into the matching mobile/web hook by passing
 *      `validate:` on the api-client call. The schema is OPTIONAL —
 *      not adopting it incrementally is fine; missing schema = same
 *      behaviour as before this PR landed.
 *
 * Intentionally NOT auto-importing every route's response into a
 * single mega-schema. The validate-on-demand pattern is what lets us
 * roll out runtime checks gradually without flag days.
 */
export * from './horses';
export * from './bookings';
