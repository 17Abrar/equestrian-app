import { z } from 'zod';
import { BOOKING_STATUS_VALUES, PAYMENT_METHOD_VALUES, PAYMENT_STATUS_VALUES } from '../../types';

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
 * fields client code reads or the shared Booking DTO promises, so a
 * server-side projection drift fails loudly without making every future
 * additive column a breaking change.
 *
 * Audit 2026-05-13 (P1): all three enums derive from canonical tuples in
 * `types/index.ts` so input schemas, response schemas, and the const-maps
 * never drift. A new payment method or booking status added there
 * propagates here automatically. PAYMENT_STATUS_VALUES matches the
 * `payment_status` pgEnum in `packages/db/src/schema/enums.ts` —
 * `'pending' | 'paid' | 'partial' | 'refunded' | 'failed' | 'overdue'`.
 */
export const bookingStatusSchema = z.enum(BOOKING_STATUS_VALUES);

export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);

export const bookingListItemSchema = z
  .object({
    id: z.string().uuid(),
    clubId: z.string().uuid(),
    slotId: z.string().uuid(),
    riderMemberId: z.string().uuid(),
    horseId: z.string().uuid().nullable(),
    status: bookingStatusSchema,
    paymentStatus: paymentStatusSchema,
    paymentMethod: z.enum(PAYMENT_METHOD_VALUES).nullable(),
    amount: z.number().int().nullable(),
    currency: z.string().length(3),
    createdAt: z.string(),
    slotDate: z.string(),
    slotStartTime: z.string(),
    slotEndTime: z.string(),
    lessonTypeName: z.string(),
    lessonTypeType: z.string(),
    lessonTypePrice: z.number().int(),
    lessonTypeCurrency: z.string().length(3),
    arenaName: z.string().nullable(),
    riderName: z.string().nullable(),
    horseName: z.string().nullable(),
  })
  .passthrough();

export type BookingListItemFromSchema = z.infer<typeof bookingListItemSchema>;
