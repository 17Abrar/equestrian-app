import { eq, and, asc, desc, sql, SQL } from 'drizzle-orm';
import { db, writeTransaction } from '../index';
import { bookingSlots, bookings, lessonTypes, arenas } from '../schema/bookings';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';

// ─── Types ────────────────────────────────────────────────────────────

type NewBookingSlot = typeof bookingSlots.$inferInsert;
type BookingSlotCreate = Omit<NewBookingSlot, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

type NewBooking = typeof bookings.$inferInsert;
type BookingCreate = Omit<NewBooking, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

interface BookingSlotFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  lessonTypeId?: string;
  coachMemberId?: string;
}

interface BookingFilters {
  status?: string;
  date?: string;
  lessonTypeId?: string;
  riderMemberId?: string;
  page: number;
  pageSize: number;
}

// ─── Booking Slots ────────────────────────────────────────────────────

export async function getBookingSlotsByClub(clubId: string, filters: BookingSlotFilters) {
  const conditions: SQL[] = [
    eq(bookingSlots.clubId, clubId),
    eq(bookingSlots.isCancelled, false),
  ];

  if (filters.date) {
    conditions.push(sql`${bookingSlots.date} = ${filters.date}`);
  }

  if (filters.dateFrom) {
    conditions.push(sql`${bookingSlots.date} >= ${filters.dateFrom}`);
  }

  if (filters.dateTo) {
    conditions.push(sql`${bookingSlots.date} <= ${filters.dateTo}`);
  }

  if (filters.lessonTypeId) {
    conditions.push(eq(bookingSlots.lessonTypeId, filters.lessonTypeId));
  }

  if (filters.coachMemberId) {
    conditions.push(eq(bookingSlots.coachMemberId, filters.coachMemberId));
  }

  return db
    .select({
      id: bookingSlots.id,
      clubId: bookingSlots.clubId,
      lessonTypeId: bookingSlots.lessonTypeId,
      arenaId: bookingSlots.arenaId,
      coachMemberId: bookingSlots.coachMemberId,
      date: bookingSlots.date,
      startTime: bookingSlots.startTime,
      endTime: bookingSlots.endTime,
      maxRiders: bookingSlots.maxRiders,
      currentRiders: bookingSlots.currentRiders,
      isCancelled: bookingSlots.isCancelled,
      createdAt: bookingSlots.createdAt,
      lessonTypeName: lessonTypes.name,
      lessonTypeType: lessonTypes.type,
      lessonTypeColor: lessonTypes.color,
      lessonTypePrice: lessonTypes.price,
      lessonTypeCurrency: lessonTypes.currency,
      arenaName: arenas.name,
      coachName: clubMembers.displayName,
    })
    .from(bookingSlots)
    .innerJoin(lessonTypes, eq(bookingSlots.lessonTypeId, lessonTypes.id))
    .leftJoin(arenas, eq(bookingSlots.arenaId, arenas.id))
    .leftJoin(clubMembers, eq(bookingSlots.coachMemberId, clubMembers.id))
    .where(and(...conditions))
    .orderBy(asc(bookingSlots.date), asc(bookingSlots.startTime));
}

export async function getBookingSlotById(clubId: string, slotId: string) {
  const result = await db
    .select({
      id: bookingSlots.id,
      clubId: bookingSlots.clubId,
      lessonTypeId: bookingSlots.lessonTypeId,
      arenaId: bookingSlots.arenaId,
      coachMemberId: bookingSlots.coachMemberId,
      date: bookingSlots.date,
      startTime: bookingSlots.startTime,
      endTime: bookingSlots.endTime,
      maxRiders: bookingSlots.maxRiders,
      currentRiders: bookingSlots.currentRiders,
      isCancelled: bookingSlots.isCancelled,
      createdAt: bookingSlots.createdAt,
      lessonTypeName: lessonTypes.name,
      lessonTypeType: lessonTypes.type,
      lessonTypePrice: lessonTypes.price,
      lessonTypeCurrency: lessonTypes.currency,
      arenaName: arenas.name,
      coachName: clubMembers.displayName,
    })
    .from(bookingSlots)
    .innerJoin(lessonTypes, eq(bookingSlots.lessonTypeId, lessonTypes.id))
    .leftJoin(arenas, eq(bookingSlots.arenaId, arenas.id))
    .leftJoin(clubMembers, eq(bookingSlots.coachMemberId, clubMembers.id))
    .where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

export async function createBookingSlot(clubId: string, data: BookingSlotCreate) {
  const result = await db.insert(bookingSlots).values({ ...data, clubId }).returning();
  return result[0];
}

export async function createBulkBookingSlots(clubId: string, slots: BookingSlotCreate[]) {
  if (slots.length === 0) return 0;

  const values = slots.map((s) => ({ ...s, clubId }));
  const result = await db.insert(bookingSlots).values(values).returning({ id: bookingSlots.id });
  return result.length;
}

export async function updateBookingSlot(
  clubId: string,
  slotId: string,
  data: Partial<Pick<typeof bookingSlots.$inferInsert, 'date' | 'startTime' | 'endTime' | 'maxRiders' | 'arenaId' | 'coachMemberId'>>,
) {
  const result = await db
    .update(bookingSlots)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

/**
 * Cancels a booking slot AND every non-terminal booking attached to it,
 * atomically. Without the cascade the slot flips to isCancelled=true but
 * the bookings stay in `confirmed` — riders get no cancellation email,
 * no refund, and their dashboard still advertises the lesson.
 *
 * Returns the cancelled slot plus the minimal booking info the caller
 * needs to fire per-rider notifications/refunds via `after()`.
 */
export async function cancelBookingSlot(clubId: string, slotId: string, reason?: string) {
  return writeTransaction(async (tx) => {
    const [slot] = await tx
      .update(bookingSlots)
      .set({
        isCancelled: true,
        cancellationReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.clubId, clubId)))
      .returning();

    if (!slot) return null;

    const cancelledBookings = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancellationReason: reason
          ? `Slot cancelled: ${reason}`
          : 'Slot cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.slotId, slotId),
          eq(bookings.clubId, clubId),
          sql`${bookings.status} NOT IN ('cancelled', 'completed', 'no_show')`,
        ),
      )
      .returning({
        id: bookings.id,
        riderMemberId: bookings.riderMemberId,
        paymentStatus: bookings.paymentStatus,
        paymentProvider: bookings.paymentProvider,
        providerPaymentId: bookings.providerPaymentId,
        amount: bookings.amount,
        currency: bookings.currency,
        guestEmail: bookings.guestEmail,
        guestName: bookings.guestName,
      });

    return { slot, cancelledBookings };
  });
}

// ─── Bookings ─────────────────────────────────────────────────────────

export async function getBookingsByClub(clubId: string, filters: BookingFilters) {
  const conditions: SQL[] = [eq(bookings.clubId, clubId)];

  if (filters.status) {
    conditions.push(sql`${bookings.status} = ${filters.status}`);
  }

  if (filters.date) {
    conditions.push(sql`${bookingSlots.date} = ${filters.date}`);
  }

  if (filters.lessonTypeId) {
    conditions.push(eq(bookingSlots.lessonTypeId, filters.lessonTypeId));
  }

  if (filters.riderMemberId) {
    conditions.push(eq(bookings.riderMemberId, filters.riderMemberId));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: bookings.id,
        clubId: bookings.clubId,
        slotId: bookings.slotId,
        riderMemberId: bookings.riderMemberId,
        horseId: bookings.horseId,
        status: bookings.status,
        paymentStatus: bookings.paymentStatus,
        amount: bookings.amount,
        currency: bookings.currency,
        horseMatchScore: bookings.horseMatchScore,
        createdAt: bookings.createdAt,
        slotDate: bookingSlots.date,
        slotStartTime: bookingSlots.startTime,
        slotEndTime: bookingSlots.endTime,
        lessonTypeName: lessonTypes.name,
        lessonTypeType: lessonTypes.type,
        arenaName: arenas.name,
        riderName: clubMembers.displayName,
        horseName: horses.name,
      })
      .from(bookings)
      .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
      .innerJoin(lessonTypes, eq(bookingSlots.lessonTypeId, lessonTypes.id))
      .leftJoin(arenas, eq(bookingSlots.arenaId, arenas.id))
      .innerJoin(clubMembers, eq(bookings.riderMemberId, clubMembers.id))
      .leftJoin(horses, eq(bookings.horseId, horses.id))
      .where(where)
      .orderBy(desc(bookingSlots.date), desc(bookingSlots.startTime))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
      .where(where),
  ]);

  return {
    data,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getBookingById(clubId: string, bookingId: string) {
  const result = await db
    .select({
      id: bookings.id,
      clubId: bookings.clubId,
      slotId: bookings.slotId,
      riderMemberId: bookings.riderMemberId,
      horseId: bookings.horseId,
      bookedByMemberId: bookings.bookedByMemberId,
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      paymentMethod: bookings.paymentMethod,
      amount: bookings.amount,
      currency: bookings.currency,
      discountAmount: bookings.discountAmount,
      horseMatchScore: bookings.horseMatchScore,
      horseMatchAuto: bookings.horseMatchAuto,
      coachNotes: bookings.coachNotes,
      cancellationReason: bookings.cancellationReason,
      cancelledAt: bookings.cancelledAt,
      checkedInAt: bookings.checkedInAt,
      createdAt: bookings.createdAt,
      paymentProvider: bookings.paymentProvider,
      providerPaymentId: bookings.providerPaymentId,
      slotDate: bookingSlots.date,
      slotStartTime: bookingSlots.startTime,
      slotEndTime: bookingSlots.endTime,
      lessonTypeName: lessonTypes.name,
      lessonTypeType: lessonTypes.type,
      lessonTypePrice: lessonTypes.price,
      lessonTypeCurrency: lessonTypes.currency,
      arenaName: arenas.name,
      riderName: clubMembers.displayName,
      horseName: horses.name,
    })
    .from(bookings)
    .innerJoin(bookingSlots, eq(bookings.slotId, bookingSlots.id))
    .innerJoin(lessonTypes, eq(bookingSlots.lessonTypeId, lessonTypes.id))
    .leftJoin(arenas, eq(bookingSlots.arenaId, arenas.id))
    .innerJoin(clubMembers, eq(bookings.riderMemberId, clubMembers.id))
    .leftJoin(horses, eq(bookings.horseId, horses.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Creates a booking and atomically increments the slot's rider count.
 * The slot update includes a capacity guard that prevents overbooking
 * under concurrent requests.
 */
export async function createBooking(clubId: string, data: BookingCreate) {
  return writeTransaction(async (tx) => {
    // Atomically increment rider count only if capacity is not exceeded.
    // This prevents the race condition where two concurrent requests both
    // pass the API-level capacity check before either transaction commits.
    const slotUpdate = await tx
      .update(bookingSlots)
      .set({
        currentRiders: sql`${bookingSlots.currentRiders} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookingSlots.id, data.slotId),
          sql`${bookingSlots.currentRiders} < ${bookingSlots.maxRiders}`,
        ),
      )
      .returning({ id: bookingSlots.id });

    if (!slotUpdate[0]) {
      throw new Error('SLOT_FULL');
    }

    const result = await tx.insert(bookings).values({ ...data, clubId }).returning();
    return result[0];
  });
}

/**
 * Cancels a booking and atomically decrements the slot's rider count.
 */
export async function cancelBooking(
  clubId: string,
  bookingId: string,
  reason: string,
  cancelledByMemberId: string,
  cancellationFee?: number,
) {
  return writeTransaction(async (tx) => {
    const result = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancellationReason: reason,
        cancellationFee: cancellationFee ?? 0,
        cancelledAt: new Date(),
        cancelledByMemberId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.clubId, clubId),
          sql`${bookings.status} NOT IN ('cancelled', 'completed')`,
        ),
      )
      .returning();

    const cancelled = result[0];

    if (cancelled) {
      await tx
        .update(bookingSlots)
        .set({
          currentRiders: sql`GREATEST(${bookingSlots.currentRiders} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(bookingSlots.id, cancelled.slotId));
    }

    return cancelled ?? null;
  });
}

/**
 * Marks a confirmed booking as no-show and records the fee.
 * Does NOT decrement the slot rider count — the rider was expected to attend.
 */
export async function markBookingNoShow(
  clubId: string,
  bookingId: string,
  noShowFee: number,
) {
  const result = await db
    .update(bookings)
    .set({
      status: 'no_show',
      cancellationFee: noShowFee,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.clubId, clubId),
        sql`${bookings.status} = 'confirmed'`,
      ),
    )
    .returning();

  return result[0] ?? null;
}

/**
 * Attaches (or updates) the payment-provider reference on a booking. Called
 * after the active provider returns a PaymentIntent / order / equivalent.
 * Idempotent — calling again with the same values is a no-op.
 */
export async function setBookingPaymentRef(
  clubId: string,
  bookingId: string,
  data: {
    paymentProvider?: 'stripe' | 'n_genius' | 'ziina';
    providerPaymentId?: string;
    paymentStatus?: 'pending' | 'paid' | 'partial' | 'refunded' | 'failed' | 'overdue';
  },
) {
  const result = await db
    .update(bookings)
    .set({
      ...(data.paymentProvider ? { paymentProvider: data.paymentProvider } : {}),
      ...(data.providerPaymentId ? { providerPaymentId: data.providerPaymentId } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
    .returning();

  return result[0] ?? null;
}

/**
 * Marks a confirmed booking as completed.
 * Typically used by staff after the lesson has taken place.
 */
/**
 * Mark a confirmed booking completed and bump the rider's lifetime lesson
 * counter so Progress / Profile stats reflect it. The counter only increments
 * on the `confirmed → completed` transition (the WHERE on status), so
 * double-clicks don't double-count.
 */
export async function markBookingComplete(
  clubId: string,
  bookingId: string,
) {
  return writeTransaction(async (tx) => {
    const result = await tx
      .update(bookings)
      .set({
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.clubId, clubId),
          sql`${bookings.status} = 'confirmed'`,
        ),
      )
      .returning();

    const row = result[0];
    if (row) {
      await tx.execute(
        sql`UPDATE rider_profiles
            SET total_lessons_completed = total_lessons_completed + 1,
                updated_at = now()
            WHERE club_id = ${clubId} AND member_id = ${row.riderMemberId}`,
      );
    }

    return row ?? null;
  });
}
