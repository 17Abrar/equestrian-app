import React from 'react';
import { type NextRequest } from 'next/server';
import { bookingFiltersSchema, createBookingSchema } from '@equestrian/shared/schemas';
import {
  getBookingsByClub,
  createBooking,
  getBookingSlotById,
  getAvailableHorsesForMatching,
  getRiderByMemberId,
  validateCoupon,
  getBookingById,
  getMemberById,
  getClubById,
} from '@equestrian/db/queries';
import { matchHorsesToRider } from '@equestrian/shared/utils';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { sendEmailAsync } from '@/lib/email';
import { BookingConfirmation } from '@equestrian/email-templates/booking-confirmation';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(bookingFiltersSchema, searchParams);

      const { data, total } = await getBookingsByClub(ctx.clubId, {
        ...filters,
        page: filters.page,
        pageSize: filters.pageSize,
      });

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'bookings:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createBookingSchema, body);

      // Verify slot exists and has capacity
      const slot = await getBookingSlotById(ctx.clubId, data.slotId);
      if (!slot) {
        return errorResponse('NOT_FOUND', 'Booking slot not found', 404);
      }

      if (slot.isCancelled) {
        return errorResponse('SLOT_CANCELLED', 'This slot has been cancelled', 422);
      }

      if (slot.currentRiders >= slot.maxRiders) {
        return errorResponse('SLOT_FULL', 'This slot is full', 422);
      }

      if (!ctx.memberId) {
        return errorResponse('NO_MEMBER', 'Your user account is not linked to a club member', 400);
      }

      let assignedHorseId = data.horseId;
      let matchScore: number | undefined;
      let wasAutoMatched = false;

      // Run smart horse matching if no horse specified and auto-match is enabled
      if (!assignedHorseId && data.autoMatchHorse) {
        const rider = await getRiderByMemberId(ctx.clubId, data.riderMemberId);

        if (rider && rider.weightKg && rider.heightCm) {
          const availableHorses = await getAvailableHorsesForMatching(
            ctx.clubId,
            slot.date,
          );

          const age = rider.dateOfBirth
            ? Math.floor(
                (Date.now() - new Date(rider.dateOfBirth).getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000),
              )
            : 18;

          const matches = matchHorsesToRider({
            rider: {
              id: rider.memberId,
              skillLevel: rider.skillLevel as 'beginner' | 'intermediate' | 'advanced',
              weight: Number(rider.weightKg),
              height: Number(rider.heightCm),
              age,
            },
            lessonType: slot.lessonTypeType,
            dateTime: `${slot.date}T${slot.startTime}`,
            availableHorses,
          });

          const topMatch = matches[0];
          if (topMatch) {
            assignedHorseId = topMatch.horse.id;
            matchScore = topMatch.score;
            wasAutoMatched = true;

            logger.info('horse_auto_matched', {
              clubId: ctx.clubId,
              riderId: data.riderMemberId,
              horseId: assignedHorseId,
              score: matchScore,
              reasons: topMatch.reasons,
            });
          }
        }
      }

      // Apply coupon if provided
      const bookingAmount = data.amount ?? slot.lessonTypePrice;
      let discountAmount = 0;
      let couponId: string | undefined;

      if (data.couponCode) {
        const couponResult = await validateCoupon({
          clubId: ctx.clubId,
          code: data.couponCode,
          amount: bookingAmount,
          riderMemberId: data.riderMemberId,
        });

        if (!couponResult.valid) {
          return errorResponse('INVALID_COUPON', couponResult.error ?? 'Invalid coupon', 422);
        }

        discountAmount = couponResult.discount;
        couponId = couponResult.couponId;
      }

      let booking;
      try {
        booking = await createBooking(ctx.clubId, {
          slotId: data.slotId,
          riderMemberId: data.riderMemberId,
          horseId: assignedHorseId,
          bookedByMemberId: ctx.memberId,
          amount: bookingAmount,
          currency: slot.lessonTypeCurrency,
          paymentMethod: data.paymentMethod,
          discountAmount,
          couponId,
          status: 'confirmed',
          horseMatchAuto: wasAutoMatched,
          horseMatchScore: matchScore,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'SLOT_FULL') {
          return errorResponse('SLOT_FULL', 'This slot is now full', 409);
        }
        throw err;
      }

      if (!booking) {
        return errorResponse('CREATE_FAILED', 'Failed to create booking', 500);
      }

      logger.info('booking_created', {
        bookingId: booking.id,
        clubId: ctx.clubId,
        slotId: data.slotId,
        riderId: data.riderMemberId,
        horseId: assignedHorseId,
        autoMatched: wasAutoMatched,
      });

      // Fire-and-forget confirmation email — does not block the response
      void Promise.all([
        getBookingById(ctx.clubId, booking.id),
        getMemberById(ctx.clubId, booking.riderMemberId),
        getClubById(ctx.clubId),
      ]).then(([fullBooking, riderMember, club]) => {
        if (!fullBooking || !riderMember?.email) return;
        sendEmailAsync({
          to: riderMember.email,
          subject: `Booking Confirmed — ${fullBooking.lessonTypeName}`,
          template: React.createElement(BookingConfirmation, {
            riderName: fullBooking.riderName ?? riderMember.displayName ?? '',
            lessonType: fullBooking.lessonTypeName,
            date: String(fullBooking.slotDate),
            time: String(fullBooking.slotStartTime),
            horseName: fullBooking.horseName ?? 'TBD',
            coachName: 'Your Coach',
            arena: fullBooking.arenaName ?? 'Arena',
            clubName: club?.name ?? '',
            clubLogo: '',
            amount: fullBooking.amount ? String(fullBooking.amount) : undefined,
            currency: fullBooking.currency ?? 'AED',
            addToCalendarUrl: '#',
          }),
        });
      }).catch(() => {
        // Email failure is non-fatal — already logged inside sendEmailAsync
      });

      return successResponse(booking, 201);
    },
    { requiredPermission: 'bookings:create' },
  );
}
