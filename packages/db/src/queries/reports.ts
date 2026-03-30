import { eq, and, sql } from 'drizzle-orm';
import { db } from '../index';
import { bookings, bookingSlots, lessonTypes } from '../schema/bookings';
import { payments } from '../schema/finances';
import { horses } from '../schema/horses';
import { clubMembers } from '../schema/club-members';

interface DateRange {
  dateFrom: string;
  dateTo: string;
}

export async function getRevenueReport(clubId: string, range: DateRange) {
  const result = await db
    .select({
      date: sql<string>`${bookingSlots.date}`,
      revenue: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
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
    .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
    .innerJoin(lessonTypes, eq(bookingSlots.lessonTypeId, lessonTypes.id))
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
    .leftJoin(bookings, and(eq(bookings.horseId, horses.id), sql`${bookings.status} != 'cancelled'`))
    .leftJoin(bookingSlots, and(eq(bookings.slotId, bookingSlots.id), sql`${bookingSlots.date} >= ${range.dateFrom}`, sql`${bookingSlots.date} <= ${range.dateTo}`))
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
    .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
    .where(
      and(
        eq(bookings.clubId, clubId),
        sql`${bookingSlots.date} >= ${range.dateFrom}`,
        sql`${bookingSlots.date} <= ${range.dateTo}`,
      ),
    );

  return result[0] ?? { totalBookings: 0, cancelledBookings: 0, noShowBookings: 0 };
}
