import { eq, and, sql, isNull } from 'drizzle-orm';
import { db } from '../index';
import { horses } from '../schema/horses';
import { bookingSlots, bookings } from '../schema/bookings';
import { clubMembers } from '../schema/club-members';
import { riderProfiles } from '../schema/rider-profiles';
import { clubs } from '../schema/clubs';
import { getTodayDateString } from '@equestrian/shared/utils';

export async function getDashboardStats(clubId: string) {
  // Resolve the club's timezone for accurate "today" calculation. A
  // tombstoned club (post-org.deleted webhook) shouldn't surface stats
  // even if the auth path missed — audit AI-32b.
  const clubRow = await db
    .select({ timezone: clubs.timezone })
    .from(clubs)
    .where(and(eq(clubs.id, clubId), isNull(clubs.deletedAt)))
    .limit(1);

  const timezone = clubRow[0]?.timezone ?? 'Asia/Dubai';
  const today = getTodayDateString(timezone);

  const [horseCounts, riderCount, todayBookingCount, todaySlotCount, recentBookings] =
    await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          available: sql<number>`count(*) filter (where ${horses.status} = 'available')::int`,
        })
        .from(horses)
        .where(and(eq(horses.clubId, clubId), isNull(horses.deletedAt))),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(riderProfiles)
        .where(eq(riderProfiles.clubId, clubId)),

      db
        .select({
          total: sql<number>`count(*)::int`,
          confirmed: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')::int`,
          pending: sql<number>`count(*) filter (where ${bookings.status} = 'pending')::int`,
        })
        .from(bookings)
        // Bind clubId on the join so a row with a mis-tenanted slotId
        // (planted by a future bug) can't surface in this club's count.
        // Audit AI-32b.
        .innerJoin(
          bookingSlots,
          and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
        )
        .where(
          and(
            eq(bookings.clubId, clubId),
            sql`${bookingSlots.date} = ${today}`,
            // Audit M-5: exclude cancelled bookings from "today's bookings"
            // counts. They were inflating the dashboard tile.
            sql`${bookings.status} != 'cancelled'`,
          ),
        ),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookingSlots)
        .where(
          and(
            eq(bookingSlots.clubId, clubId),
            sql`${bookingSlots.date} = ${today}`,
            eq(bookingSlots.isCancelled, false),
          ),
        ),

      db
        .select({
          id: bookings.id,
          status: bookings.status,
          createdAt: bookings.createdAt,
          slotDate: bookingSlots.date,
          slotStartTime: bookingSlots.startTime,
          riderName: clubMembers.displayName,
        })
        .from(bookings)
        .innerJoin(
          bookingSlots,
          and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
        )
        .innerJoin(
          clubMembers,
          and(eq(bookings.riderMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
        )
        .where(eq(bookings.clubId, clubId))
        .orderBy(sql`${bookings.createdAt} desc`)
        .limit(5),
    ]);

  return {
    horses: {
      total: horseCounts[0]?.total ?? 0,
      available: horseCounts[0]?.available ?? 0,
    },
    riders: {
      total: riderCount[0]?.count ?? 0,
    },
    todayBookings: {
      total: todayBookingCount[0]?.total ?? 0,
      confirmed: todayBookingCount[0]?.confirmed ?? 0,
      pending: todayBookingCount[0]?.pending ?? 0,
    },
    todaySlots: todaySlotCount[0]?.count ?? 0,
    recentBookings,
  };
}
