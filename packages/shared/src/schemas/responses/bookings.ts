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
 * stamps lookup-derived auxiliary fields that list screens ignore. The
 * schema gates the fields client code reads or the shared Booking DTO
 * promises, so a server-side projection drift fails loudly without making
 * every future additive column a breaking change.
 */
export const bookingStatusSchema = z.enum([
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'pending',
]);

export const paymentStatusSchema = z.enum([
  'pending',
  'paid',
  'partial',
  'refunded',
  'failed',
  'overdue',
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
    paymentMethod: z
      .enum([
        'card',
        'apple_pay',
        'google_pay',
        'tabby',
        'tamara',
        'knet',
        'mada',
        'benefit',
        'cash',
        'card_in_person',
        'package_credit',
        'bank_transfer',
      ])
      .nullable(),
    amount: z.number().int().nullable(),
    currency: z.string(),
    createdAt: z.string(),
    slotDate: z.string(),
    slotStartTime: z.string(),
    slotEndTime: z.string(),
    lessonTypeName: z.string(),
    lessonTypeType: z.string(),
    lessonTypePrice: z.number().int(),
    lessonTypeCurrency: z.string(),
    arenaName: z.string().nullable(),
    riderName: z.string().nullable(),
    horseName: z.string().nullable(),
  })
  .passthrough();

export type BookingListItemFromSchema = z.infer<typeof bookingListItemSchema>;
