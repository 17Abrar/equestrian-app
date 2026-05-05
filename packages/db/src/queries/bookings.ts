import { eq, and, asc, desc, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { db, writeTransaction } from '../index';
import { bookingSlots, bookings, lessonTypes, arenas } from '../schema/bookings';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';
import { coupons, couponUsages } from '../schema/packages';
import { riderProfiles } from '../schema/rider-profiles';
import { calculateCouponDiscount } from '@equestrian/shared/utils';

// ─── Types ────────────────────────────────────────────────────────────

type NewBookingSlot = typeof bookingSlots.$inferInsert;
type BookingSlotCreate = Omit<NewBookingSlot, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

type NewBooking = typeof bookings.$inferInsert;
type BookingCreateBase = Omit<NewBooking, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

/**
 * Audit MED (2026-05-05 pass 2): when `couponId` is set, the caller now
 * passes `grossAmount` instead of pre-computing `amount`/`discountAmount`
 * — `createBooking` recomputes the discount under the locked coupon's
 * effective `discountValue`/`maxDiscount`. This closes the TOCTOU gap
 * where an admin tightening `maxDiscount` between the route's
 * `validateCoupon` pre-flight and the in-tx lock would let the rider
 * keep the looser pre-flight rate. When `couponId` is unset, `amount`
 * is used as-is (no coupon math).
 */
type BookingCreate = BookingCreateBase & {
  /** Pre-discount lesson price. Required when `couponId` is set;
   *  ignored otherwise (caller passes the final `amount` directly). */
  grossAmount?: number;
};

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
  /**
   * Match bookings where `rider_member_id` is in the supplied list. Used by
   * the parent-role GET path to pull "self + dependents" in one query
   * without forcing the route to fan out per-child requests. When both
   * `riderMemberId` and `riderMemberIds` are set the AND-combination is
   * empty unless the single id is in the list — callers should pick one.
   */
  riderMemberIds?: string[];
  page: number;
  pageSize: number;
}

// ─── Booking lifecycle ────────────────────────────────────────────────

/**
 * Allowed booking-status transitions. Audit AI-31 — surfacing the matrix
 * here means future write paths can call `canTransitionBookingStatus`
 * instead of open-coding `WHERE status = 'X'` clauses (and risk
 * forgetting one). The SQL guards in `markBookingComplete`,
 * `markBookingNoShow`, and `cancelBooking` mirror this matrix exactly;
 * a future unit test should validate the parity.
 *
 * Terminal states (`completed`, `no_show`, `cancelled`) carry no outgoing
 * edges — undoing a no-show or completed booking requires a dedicated
 * reversal endpoint, not a generic status flip.
 */
export const BOOKING_STATUS_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
} as const;

export function canTransitionBookingStatus(from: string, to: string): boolean {
  return BOOKING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
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
    // Defence-in-depth: tenant-owned joined tables (lesson_types, arenas,
    // club_members) all carry club_id, but FK chains alone don't enforce
    // it — a migration error or hand-written SQL could attach a slot to a
    // foreign-club lesson type. Mirroring the clubId condition into each
    // join keeps a stale row from leaking into a hot-path read.
    .innerJoin(
      lessonTypes,
      and(eq(bookingSlots.lessonTypeId, lessonTypes.id), eq(lessonTypes.clubId, clubId)),
    )
    .leftJoin(arenas, and(eq(bookingSlots.arenaId, arenas.id), eq(arenas.clubId, clubId)))
    .leftJoin(
      clubMembers,
      and(eq(bookingSlots.coachMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .where(and(...conditions))
    .orderBy(asc(bookingSlots.date), asc(bookingSlots.startTime))
    // Defensive cap (audit G-8). Without it, a `dateFrom=1970-01-01&dateTo=
    // 2099-12-31` request returns every slot the club ever created — a
    // 5MB+ JSON payload on a busy stable. The route enforces a 90-day
    // window via Zod, but the DB cap is the last line of defence.
    .limit(2000);
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
    .innerJoin(
      lessonTypes,
      and(eq(bookingSlots.lessonTypeId, lessonTypes.id), eq(lessonTypes.clubId, clubId)),
    )
    .leftJoin(arenas, and(eq(bookingSlots.arenaId, arenas.id), eq(arenas.clubId, clubId)))
    .leftJoin(
      clubMembers,
      and(eq(bookingSlots.coachMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
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

/**
 * Updates a booking slot in place. Returns:
 *   - the updated row on success
 *   - `{ notFound: true }` when no slot with this id/club exists
 *   - `{ cancelled: true }` when the slot exists but is cancelled (terminal
 *     state — editable fields would mutate something the cancellation
 *     cascade has already settled)
 *
 * The caller is expected to map these to 404 / 409 respectively.
 */
export async function updateBookingSlot(
  clubId: string,
  slotId: string,
  data: Partial<Pick<typeof bookingSlots.$inferInsert, 'date' | 'startTime' | 'endTime' | 'maxRiders' | 'arenaId' | 'coachMemberId'>>,
): Promise<typeof bookingSlots.$inferSelect | { notFound: true } | { cancelled: true }> {
  const result = await db
    .update(bookingSlots)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(bookingSlots.id, slotId),
        eq(bookingSlots.clubId, clubId),
        eq(bookingSlots.isCancelled, false),
      ),
    )
    .returning();

  if (result[0]) return result[0];

  // The UPDATE matched zero rows. Distinguish "doesn't exist" from
  // "exists but cancelled" so the route can surface a useful error.
  const probe = await db
    .select({ id: bookingSlots.id })
    .from(bookingSlots)
    .where(and(eq(bookingSlots.id, slotId), eq(bookingSlots.clubId, clubId)))
    .limit(1);

  return probe[0] ? { cancelled: true } : { notFound: true };
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

  if (filters.riderMemberIds && filters.riderMemberIds.length > 0) {
    conditions.push(inArray(bookings.riderMemberId, filters.riderMemberIds));
  } else if (filters.riderMemberIds && filters.riderMemberIds.length === 0) {
    // Empty allowlist must yield zero results — without this short-circuit
    // the missing IN-clause would let the query fall through and return
    // every booking the tenant owns.
    return { data: [], total: 0 };
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
      .innerJoin(
        bookingSlots,
        and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
      )
      .innerJoin(
        lessonTypes,
        and(eq(bookingSlots.lessonTypeId, lessonTypes.id), eq(lessonTypes.clubId, clubId)),
      )
      .leftJoin(arenas, and(eq(bookingSlots.arenaId, arenas.id), eq(arenas.clubId, clubId)))
      .innerJoin(
        clubMembers,
        and(eq(bookings.riderMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
      )
      // Soft-deleted horses shouldn't surface their name in historical bookings —
      // F-2. The leftJoin stays a leftJoin (NULL is fine; the name just becomes
      // unavailable, matching what a hard delete would show).
      .leftJoin(
        horses,
        and(eq(bookings.horseId, horses.id), eq(horses.clubId, clubId), isNull(horses.deletedAt)),
      )
      .where(where)
      .orderBy(desc(bookingSlots.date), desc(bookingSlots.startTime))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(
        bookingSlots,
        and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
      )
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
      refundedAmountMinor: bookings.refundedAmountMinor,
      cancellationFee: bookings.cancellationFee,
      horseMatchScore: bookings.horseMatchScore,
      horseMatchAuto: bookings.horseMatchAuto,
      coachNotes: bookings.coachNotes,
      cancellationReason: bookings.cancellationReason,
      cancelledAt: bookings.cancelledAt,
      checkedInAt: bookings.checkedInAt,
      createdAt: bookings.createdAt,
      paymentProvider: bookings.paymentProvider,
      providerPaymentId: bookings.providerPaymentId,
      isGuestBooking: bookings.isGuestBooking,
      guestName: bookings.guestName,
      guestEmail: bookings.guestEmail,
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
    .innerJoin(
      bookingSlots,
      and(eq(bookings.slotId, bookingSlots.id), eq(bookingSlots.clubId, clubId)),
    )
    .innerJoin(
      lessonTypes,
      and(eq(bookingSlots.lessonTypeId, lessonTypes.id), eq(lessonTypes.clubId, clubId)),
    )
    .leftJoin(arenas, and(eq(bookingSlots.arenaId, arenas.id), eq(arenas.clubId, clubId)))
    .innerJoin(
      clubMembers,
      and(eq(bookings.riderMemberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
    )
    .leftJoin(
      horses,
      and(eq(bookings.horseId, horses.id), eq(horses.clubId, clubId), isNull(horses.deletedAt)),
    )
    .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Creates a booking and atomically increments the slot's rider count.
 * The slot update includes a capacity guard that prevents overbooking
 * under concurrent requests. When a coupon is applied, locks the coupon
 * row (FOR UPDATE), re-checks the maxUses / maxUsesPerRider gates, and
 * then records the usage and bumps `coupons.usage_count` inside the same
 * transaction.
 *
 * The lock-and-recheck is what closes the TOCTOU window between the
 * pre-flight `validateCoupon` call (in the route) and the usage insert:
 * without it, two parallel bookings by the same rider both pass the
 * pre-flight (each reads count=0) and then both insert a usage row,
 * blowing past `max_uses_per_rider`. The route maps the recheck failures
 * (COUPON_*) back to 422 INVALID_COUPON for the user.
 */
export async function createBooking(clubId: string, data: BookingCreate) {
  return writeTransaction(async (tx) => {
    // Lock the coupon row first, BEFORE the slot update, so a coupon
    // failure rolls back without touching slot capacity. Any concurrent
    // booking by the same rider waits behind this lock and then re-reads
    // the now-current `usage_count` / per-rider count.
    // Audit MED (2026-05-05 pass 2): TOCTOU recompute. Lock the coupon and
    // re-derive `discount`/`amount` from the LOCKED `discountType` /
    // `discountValue` / `maxDiscount` columns rather than trusting the
    // route's pre-flight numbers. An admin who tightens `maxDiscount`
    // between the pre-flight and this lock can no longer leave the rider
    // paying the looser pre-flight rate.
    let recomputedAmount: number | null = null;
    let recomputedDiscount: number | null = null;
    if (data.couponId) {
      const lockedCoupon = await tx
        .select({
          id: coupons.id,
          maxUses: coupons.maxUses,
          maxUsesPerRider: coupons.maxUsesPerRider,
          usageCount: coupons.usageCount,
          discountType: coupons.discountType,
          discountValue: coupons.discountValue,
          maxDiscount: coupons.maxDiscount,
        })
        .from(coupons)
        .where(and(eq(coupons.id, data.couponId), eq(coupons.clubId, clubId)))
        .for('update')
        .limit(1);

      const c = lockedCoupon[0];
      if (!c) {
        throw new Error('COUPON_NOT_FOUND');
      }

      if (c.maxUses != null && c.usageCount >= c.maxUses) {
        throw new Error('COUPON_MAX_USES_REACHED');
      }

      if (c.maxUsesPerRider != null) {
        const riderCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(couponUsages)
          .where(
            and(
              eq(couponUsages.clubId, clubId),
              eq(couponUsages.couponId, data.couponId),
              eq(couponUsages.riderMemberId, data.riderMemberId),
            ),
          );
        if ((riderCount[0]?.count ?? 0) >= c.maxUsesPerRider) {
          throw new Error('COUPON_RIDER_MAX_USES_REACHED');
        }
      }

      // Recompute. Falls back to caller-supplied `amount` when grossAmount
      // is omitted (legacy callers); the recompute then derives the
      // pre-discount value as amount + discountAmount.
      const gross =
        data.grossAmount ?? (data.amount ?? 0) + (data.discountAmount ?? 0);
      recomputedDiscount = calculateCouponDiscount({
        amount: gross,
        discountType: c.discountType as 'percentage' | 'fixed',
        discountValue: c.discountValue,
        maxDiscount: c.maxDiscount,
      });
      recomputedAmount = Math.max(0, gross - recomputedDiscount);
    }

    // Atomically increment rider count only if (a) capacity is not exceeded,
    // (b) the slot is not cancelled, and (c) the slot belongs to this club.
    //
    // (a) prevents the overbooking race the original fix addressed.
    // (b) closes a second race: an admin's cancelBookingSlot can commit
    //     between the route's pre-flight read and this UPDATE, leaving us
    //     about to insert a confirmed booking on a now-cancelled slot.
    //     The cancellation cascade has already run and won't see this new
    //     row — the rider would receive no cancellation email and no refund.
    // (c) is defence-in-depth: any future regression that bypasses the API
    //     pre-flight cannot write a booking row with clubId=A against a
    //     slot whose clubId=B.
    const slotUpdate = await tx
      .update(bookingSlots)
      .set({
        currentRiders: sql`${bookingSlots.currentRiders} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookingSlots.id, data.slotId),
          eq(bookingSlots.clubId, clubId),
          eq(bookingSlots.isCancelled, false),
          sql`${bookingSlots.currentRiders} < ${bookingSlots.maxRiders}`,
        ),
      )
      .returning({ id: bookingSlots.id });

    if (!slotUpdate[0]) {
      throw new Error('SLOT_FULL');
    }

    // Audit MED (2026-05-05 pass 2): write the POST-lock `recomputedAmount` /
    // `recomputedDiscount` if the coupon was locked above. Otherwise fall
    // through to caller-supplied values (no coupon path).
    const insertValues = (
      recomputedAmount !== null && recomputedDiscount !== null
        ? {
            ...data,
            clubId,
            amount: recomputedAmount,
            discountAmount: recomputedDiscount,
          }
        : { ...data, clubId }
    ) as typeof bookings.$inferInsert;
    // `grossAmount` is a convention parameter on `BookingCreate` only —
    // strip it before handing to Drizzle.
    if ('grossAmount' in insertValues) {
      delete (insertValues as Record<string, unknown>).grossAmount;
    }
    const result = await tx.insert(bookings).values(insertValues).returning();
    const booking = result[0];

    // Without this, the gates checked above stay at 0 forever and the same
    // coupon can be re-applied indefinitely. The booking holds the NET
    // (charged) amount; reconstruct the original sticker price by adding
    // the discount back.
    if (booking && data.couponId) {
      const finalAmount = recomputedAmount ?? data.amount ?? 0;
      const discount = recomputedDiscount ?? data.discountAmount ?? 0;
      const originalAmount = finalAmount + discount;
      await tx.insert(couponUsages).values({
        clubId,
        couponId: data.couponId,
        riderMemberId: data.riderMemberId,
        bookingId: booking.id,
        originalAmount,
        discountAmount: discount,
        finalAmount,
      });
      await tx
        .update(coupons)
        .set({
          usageCount: sql`${coupons.usageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(coupons.id, data.couponId), eq(coupons.clubId, clubId)));
    }

    return booking;
  });
}

/**
 * Cancels a booking and atomically decrements the slot's rider count.
 *
 * `no_show` is included in the terminal-state guard alongside `cancelled` and
 * `completed` (audit E-1) — a no-show booking already records its own
 * `cancellationFee` (the no-show penalty) and keeps the slot's rider count
 * intact for attendance reporting; allowing a follow-up cancel would clobber
 * both. Use a dedicated reversal endpoint if a no-show ever needs revisiting.
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
          sql`${bookings.status} NOT IN ('cancelled', 'completed', 'no_show')`,
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
 * Atomically records a successful refund: adds `amountMinor` to the
 * booking's running `refundedAmountMinor` and flips `paymentStatus` to
 * 'partial' or 'refunded' based on whether the total equals the
 * original amount.
 *
 * Returns `null` if:
 *   - The booking doesn't exist or is in another club.
 *   - The booking has no captured `amount` (shouldn't happen for paid
 *     bookings, but guards a bad state).
 *   - The cumulative refund would exceed `amount` (caller should have
 *     validated this; the DB-level CHECK is a belt-and-braces guard).
 *
 * The single UPDATE with a WHERE on the pre-refund `refundedAmountMinor`
 * serialises concurrent refund attempts — if two admins click "refund"
 * at the same time, only one UPDATE sees its expected pre-state.
 */
export async function recordBookingRefund(
  clubId: string,
  bookingId: string,
  amountMinor: number,
): Promise<{
  id: string;
  paymentStatus: string;
  refundedAmountMinor: number;
} | null> {
  if (amountMinor <= 0) return null;

  // Audit HIGH-4 (2026-05-05): wrap the read+CAS pair in a writeTransaction
  // with `SELECT … FOR UPDATE` so concurrent calls (admin click + webhook
  // arrival, two webhooks racing) serialise on the row lock instead of
  // both reading the same baseline and one losing the optimistic CAS
  // unpredictably. The CAS predicate is kept as belt-and-braces.
  return writeTransaction(async (tx) => {
    const existing = await tx
      .select({
        amount: bookings.amount,
        refundedAmountMinor: bookings.refundedAmountMinor,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
      .for('update')
      .limit(1);

    const current = existing[0];
    if (!current || current.amount == null) return null;

    const newRefunded = current.refundedAmountMinor + amountMinor;
    if (newRefunded > current.amount) return null;

    const newStatus = newRefunded >= current.amount ? 'refunded' : 'partial';

    const result = await tx
      .update(bookings)
      .set({
        refundedAmountMinor: newRefunded,
        paymentStatus: newStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.clubId, clubId),
          // CAS belt-and-braces under FOR UPDATE — guards a future
          // caller that bypasses the lock.
          eq(bookings.refundedAmountMinor, current.refundedAmountMinor),
        ),
      )
      .returning({
        id: bookings.id,
        paymentStatus: bookings.paymentStatus,
        refundedAmountMinor: bookings.refundedAmountMinor,
      });

    return result[0] ?? null;
  });
}

/**
 * Reverses a previously-recorded refund — used when a provider webhook
 * reports the refund transitioned `pending → failed` after we already
 * incremented the ledger (audit B-4). Decrements `refundedAmountMinor` by
 * `amountMinor` and recomputes `paymentStatus`:
 *   * back to `'partial'` if some refund total remains
 *   * back to `'paid'` if the running total drops to zero
 *
 * Returns `null` if the booking can't be found, the running total is
 * already smaller than `amountMinor` (shouldn't happen — webhook arrived
 * for a refund we never recorded; webhook handler logs and ignores), or
 * an optimistic-concurrency conflict means another caller mutated the
 * ledger in the meantime.
 */
export async function reverseBookingRefund(
  clubId: string,
  bookingId: string,
  amountMinor: number,
): Promise<{
  id: string;
  paymentStatus: string;
  refundedAmountMinor: number;
} | null> {
  if (amountMinor <= 0) return null;

  // Audit HIGH-4 (2026-05-05): same writeTransaction + FOR UPDATE
  // treatment as recordBookingRefund — concurrent reverses (or a
  // reverse racing a record) serialise cleanly on the row lock.
  return writeTransaction(async (tx) => {
    const existing = await tx
      .select({
        amount: bookings.amount,
        refundedAmountMinor: bookings.refundedAmountMinor,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
      .for('update')
      .limit(1);

    const current = existing[0];
    if (!current || current.amount == null) return null;

    // Don't drive the ledger negative — webhook arrived for a refund we
    // never recorded, leave to operator.
    if (current.refundedAmountMinor < amountMinor) return null;

    const newRefunded = current.refundedAmountMinor - amountMinor;
    const newStatus = newRefunded === 0 ? 'paid' : 'partial';

    const result = await tx
      .update(bookings)
      .set({
        refundedAmountMinor: newRefunded,
        paymentStatus: newStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.clubId, clubId),
          eq(bookings.refundedAmountMinor, current.refundedAmountMinor),
        ),
      )
      .returning({
        id: bookings.id,
        paymentStatus: bookings.paymentStatus,
        refundedAmountMinor: bookings.refundedAmountMinor,
      });

    return result[0] ?? null;
  });
}

/**
 * Attaches (or updates) the payment-provider reference on a booking. Called
 * after the active provider returns a PaymentIntent / order / equivalent.
 * Idempotent — calling again with the same values is a no-op.
 *
 * CAS guard on `providerPaymentId` (audit B-19): when this call is
 * setting/updating providerPaymentId, the WHERE only matches if the
 * existing column is either NULL (first attach) or already equal to the
 * new value (idempotent re-write). Without this, a stale webhook for a
 * previously-abandoned PaymentIntent could overwrite the live PI's id —
 * subsequent webhooks for the live PI would then miss the booking and
 * the rider's payment status would never settle.
 */
export async function setBookingPaymentRef(
  clubId: string,
  bookingId: string,
  data: {
    paymentProvider?: 'stripe' | 'n_genius' | 'ziina';
    providerPaymentId?: string;
    // 'overdue' is a livery-invoice-only status; bookings never go there.
    // Removing it from the union (audit L-4) reflects the actual call sites.
    paymentStatus?: 'pending' | 'paid' | 'partial' | 'refunded' | 'failed';
  },
) {
  const conditions = [eq(bookings.id, bookingId), eq(bookings.clubId, clubId)];
  if (data.providerPaymentId) {
    conditions.push(
      sql`(${bookings.providerPaymentId} IS NULL OR ${bookings.providerPaymentId} = ${data.providerPaymentId})`,
    );
  }
  // Terminal-state guard for paymentStatus (audit E-11 + HIGH-13).
  // Once a booking is in `refunded` / `partial`, subsequent
  // setBookingPaymentRef calls must NOT downgrade to other states —
  // webhooks arriving out of order would otherwise rewrite the
  // rider's settled state. Audit HIGH-13 (2026-05-05) extends this:
  // once `paid`, an out-of-order `payment_intent.processing` event
  // (which maps to `pending`) must NOT downgrade the booking back to
  // `pending`/`failed`. Only forward transitions (paid → refunded,
  // paid → partial) are allowed, and idempotent re-writes (paid →
  // paid) pass through harmlessly.
  if (data.paymentStatus) {
    if (data.paymentStatus !== 'refunded' && data.paymentStatus !== 'partial') {
      conditions.push(
        sql`${bookings.paymentStatus} NOT IN ('refunded', 'partial')`,
      );
    }
    // Block paid → {pending, failed, requires_action} downgrades.
    // Only `paid → paid` (idempotent) and forward transitions to
    // refunded/partial pass.
    if (data.paymentStatus !== 'paid' && data.paymentStatus !== 'refunded' && data.paymentStatus !== 'partial') {
      conditions.push(
        sql`${bookings.paymentStatus} != 'paid'`,
      );
    }
  }

  const result = await db
    .update(bookings)
    .set({
      ...(data.paymentProvider ? { paymentProvider: data.paymentProvider } : {}),
      ...(data.providerPaymentId ? { providerPaymentId: data.providerPaymentId } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus } : {}),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
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
      // Audit LOW-4 (2026-05-05): rewritten via Drizzle builder so the
      // expression participates in type-checking and follows the
      // codebase's house style. Functionally identical SQL.
      await tx
        .update(riderProfiles)
        .set({
          totalLessonsCompleted: sql`${riderProfiles.totalLessonsCompleted} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(riderProfiles.clubId, clubId),
            eq(riderProfiles.memberId, row.riderMemberId),
          ),
        );
    }

    return row ?? null;
  });
}
