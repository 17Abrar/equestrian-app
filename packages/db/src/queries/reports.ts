import { eq, and, sql } from 'drizzle-orm';
import { db } from '../index';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { payments } from '../schema/finances';
import { horses } from '../schema/horses';

interface DateRange {
  dateFrom: string;
  dateTo: string;
}

// Defence-in-depth on cross-tenant joins. The single-table WHERE on the
// driving table's clubId already guarantees correct results in a healthy
// DB, since FK chains keep child rows in the same club. But there is no
// CHECK ensuring a payment's bookingId points at a booking with the same
// clubId, so a migration error or hand-written SQL could break the
// invariant — and these reports would silently mix tenants. Mirroring the
// clubId condition into each join condition contains the blast radius.

export async function getRevenueReport(clubId: string, range: DateRange) {
  const result = await db
    .select({
      date: sql<string>`${bookingSlots.date}`,
      revenue: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(
      bookings,
      and(eq(payments.bookingId, bookings.id), eq(bookings.clubId, clubId)),
    )
    .innerJoin(
      bookingSlots,
      and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
    )
    .where(
      and(
        eq(payments.clubId, clubId),
        sql`${payments.status} = 'paid'`,
        sql`${bookingSlots.date} >= ${range.dateFrom}`,
        sql`${bookingSlots.date} <= ${range.dateTo}`,
      ),
    )
    .groupBy(bookingSlots.date)
    .orderBy(bookingSlots.date);

  return result;
}

export async function getLessonPopularityReport(clubId: string, range: DateRange) {
  const result = await db
    .select({
      lessonTypeName: lessonTypes.name,
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(
      bookingSlots,
      and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
    )
    .innerJoin(
      lessonTypes,
      and(eq(bookingSlots.lessonTypeId, lessonTypes.id), eq(lessonTypes.clubId, clubId)),
    )
    .where(
      and(
        eq(bookings.clubId, clubId),
        sql`${bookingSlots.date} >= ${range.dateFrom}`,
        sql`${bookingSlots.date} <= ${range.dateTo}`,
      ),
    )
    .groupBy(lessonTypes.name)
    .orderBy(sql`count(*) desc`);

  return result;
}

export async function getHorseUtilizationReport(clubId: string, range: DateRange) {
  const result = await db
    .select({
      horseName: horses.name,
      bookingCount: sql<number>`count(${bookings.id})::int`,
      maxLessonsPerDay: horses.maxLessonsPerDay,
    })
    .from(horses)
    .leftJoin(
      bookings,
      and(
        eq(bookings.horseId, horses.id),
        eq(bookings.clubId, clubId),
        sql`${bookings.status} != 'cancelled'`,
      ),
    )
    .leftJoin(
      bookingSlots,
      and(
        eq(bookings.slotId, bookingSlots.id),
        eq(bookingSlots.clubId, clubId),
        sql`${bookingSlots.date} >= ${range.dateFrom}`,
        sql`${bookingSlots.date} <= ${range.dateTo}`,
      ),
    )
    .where(and(eq(horses.clubId, clubId), sql`${horses.deletedAt} IS NULL`))
    .groupBy(horses.id, horses.name, horses.maxLessonsPerDay)
    .orderBy(sql`count(${bookings.id}) desc`);

  return result;
}

export async function getCancellationReport(clubId: string, range: DateRange) {
  const result = await db
    .select({
      totalBookings: sql<number>`count(*)::int`,
      cancelledBookings: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled')::int`,
      noShowBookings: sql<number>`count(*) filter (where ${bookings.status} = 'no_show')::int`,
    })
    .from(bookings)
    .innerJoin(
      bookingSlots,
      and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
    )
    .where(
      and(
        eq(bookings.clubId, clubId),
        sql`${bookingSlots.date} >= ${range.dateFrom}`,
        sql`${bookingSlots.date} <= ${range.dateTo}`,
      ),
    );

  return result[0] ?? { totalBookings: 0, cancelledBookings: 0, noShowBookings: 0 };
}
