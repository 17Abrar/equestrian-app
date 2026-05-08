import { z } from 'zod';

/**
 * Audit F-69 companion (2026-05-08 r6): runtime schema for the
 * paginated booking-list projection returned by `GET /api/v1/bookings`
 * (mobile rider-facing) and the wider booking-row shape used in mutation
 * responses. See the interface in
 * `apps/mobile/hooks/use-bookings.ts > Booking` for the type-of-record
 * shape. The schema here is what the api-client uses at runtime to
 * fail-loud on a server-side projection drift before the mobile UI
 * dereferences `undefined`.
 *
 * `.passthrough()` is deliberate — the route's projection occasionally
 * stamps lookup-derived auxiliary fields (lessonTypePrice, arena
 * coordinates) that the mobile UI ignores. The schema gates only the
 * fields the mobile UI READS, so adding a new server-side column
 * doesn't trip the validator until a mobile consumer asks for it.
 */
export const bookingStatusSchema = z.enum([
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'pending',
]);

export const paymentStatusSchema = z.enum([
  'unpaid',
  'paid',
  'pending',
  'refunded',
  'partial',
  'failed',
  'requires_action',
]);

export const bookingListItemSchema = z
  .object({
    id: z.string().uuid(),
    clubId: z.string().uuid(),
    slotId: z.string().uuid(),
    riderMemberId: z.string().uuid(),
    horseId: z.string().uuid().nullable(),
    status: bookingStatusSchema,
    paymentStatus: paymentStatusSchema,
    amount: z.number().int().nullable(),
    currency: z.string(),
    createdAt: z.string(),
    slotDate: z.string(),
    slotStartTime: z.string(),
    slotEndTime: z.string(),
    lessonTypeName: z.string(),
    lessonTypeType: z.string(),
    arenaName: z.string().nullable(),
    riderName: z.string().nullable(),
    horseName: z.string().nullable(),
  })
  .passthrough();

export type BookingListItemFromSchema = z.infer<typeof bookingListItemSchema>;
