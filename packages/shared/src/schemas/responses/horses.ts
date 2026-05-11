import { z } from 'zod';

/**
 * Audit F-69 companion (2026-05-08 r6): runtime schema for the list
 * projection returned by `GET /api/v1/horses`. Mirrors the
 * `HorseListItem` interface in `apps/web/hooks/use-horses.ts` and the
 * mobile `Horse` shape in `apps/mobile/hooks/use-horses.ts` — those
 * interfaces remain the type-of-record (Drizzle's row inference is a
 * source of truth for the server) but this schema is the runtime gate
 * the api-client uses to fail-loud on a server-side projection drift.
 *
 * Why both an interface AND a schema: the interface is structurally
 * derived from the SQL projection (server-authoritative); the schema
 * is the contract the *client* has agreed to consume. Drift between
 * them is exactly what F-69 wants to catch — a server-side projection
 * change that adds a `null` or removes a column would have silently
 * propagated as `undefined` deref in production. With the schema in
 * place, the api-client surfaces an `INVALID_RESPONSE` immediately
 * and `onError` captures which field drifted.
 *
 * Keep the column union literals in sync with
 * `packages/db/src/schema/enums.ts` — those are the canonical lists.
 */
export const horseStatusSchema = z.enum([
  'available',
  'resting',
  'injured',
  'retired',
  'off_site',
  'sold',
]);

export const horseSkillLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);

export const horseOwnershipStatusSchema = z.enum(['pending', 'active', 'retired', 'declined']);

/**
 * Runtime schema for `GET /api/v1/horses` paginated list items.
 * Mirrors the server-side projection in
 * `packages/db/src/queries/horses.ts > getHorsesByClub` and the
 * `HorseListItem` interface in `apps/web/hooks/use-horses.ts`.
 */
export const horseListItemSchema = z
  .object({
    id: z.string().uuid(),
    clubId: z.string().uuid(),
    name: z.string(),
    primaryPhotoUrl: z.string().nullable(),
    breed: z.string().nullable(),
    gender: z.string().nullable(),
    color: z.string().nullable(),
    heightHands: z.string().nullable(),
    weightKg: z.string().nullable(),
    status: horseStatusSchema,
    skillLevel: horseSkillLevelSchema,
    weightLimitKg: z.string().nullable(),
    notes: z.string().nullable(),
    ownerMemberId: z.string().uuid().nullable(),
    ownershipStatus: horseOwnershipStatusSchema,
    ownershipSubmittedAt: z.string().nullable(),
    ownerName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export type HorseListItemFromSchema = z.infer<typeof horseListItemSchema>;
