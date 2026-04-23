import React from 'react';
import { type NextRequest, after } from 'next/server';
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
import { hasPermission } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { sendTriggeredEmail } from '@/lib/email';
import { BookingConfirmation } from '@equestrian/email-templates/booking-confirmation';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(bookingFiltersSchema, searchParams);

      // Riders/parents can only see their own bookings
      const canReadAll = hasPermission(ctx.orgRole, 'bookings:read');
      const canReadOwn = hasPermission(ctx.orgRole, 'bookings:read_own') || hasPermission(ctx.orgRole, 'bookings:read_child');

      if (!canReadAll && !canReadOwn) {
        return errorResponse('FORBIDDEN', 'You do not have permission to view bookings', 403);
      }

      // Security: riders MUST be scoped to their own memberId — never allow them to query other riders
      let riderMemberIdFilter = filters.riderMemberId;
      if (!canReadAll) {
        if (!ctx.memberId) {
          return errorResponse('NO_MEMBER', 'Member profile not found. Contact your club admin.', 403);
        }
        if (filters.riderMemberId && filters.riderMemberId !== ctx.memberId) {
          return errorResponse('FORBIDDEN', 'You can only view your own bookings', 403);
        }
        riderMemberIdFilter = ctx.memberId;
      }

      const effectiveFilters = {
        ...filters,
        riderMemberId: riderMemberIdFilter,
        page: filters.page,
        pageSize: filters.pageSize,
      };

      const { data, total } = await getBookingsByClub(ctx.clubId, effectiveFilters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
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

      // Security: riders can only book for themselves
      const canBookForOthers = hasPermission(ctx.orgRole, 'bookings:create') && hasPermission(ctx.orgRole, 'bookings:read');
      if (!canBookForOthers && data.riderMemberId !== ctx.memberId) {
        return errorResponse('FORBIDDEN', 'You can only create bookings for yourself', 403);
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
        requestId: ctx.requestId,
        bookingId: booking.id,
        clubId: ctx.clubId,
        slotId: data.slotId,
        riderId: data.riderMemberId,
        horseId: assignedHorseId,
        autoMatched: wasAutoMatched,
      });

      void ctx.audit({
        action: 'booking.create',
        resourceType: 'booking',
        resourceId: booking.id,
      });

      // Post-response confirmation email — `after()` keeps the task alive
      // past response flush on Cloudflare Workers, where bare fire-and-forget
      // promises get killed when the isolate freezes.
      logger.info('email_flow_marker', {
        step: 'before_after_registered',
        bookingId: booking.id,
        clubId: ctx.clubId,
      });
      after(async () => {
        logger.info('email_flow_marker', {
          step: 'inside_after_callback',
          bookingId: booking.id,
        });
        try {
          const [fullBooking, riderMember, club] = await Promise.all([
            getBookingById(ctx.clubId, booking.id),
            getMemberById(ctx.clubId, booking.riderMemberId),
            getClubById(ctx.clubId),
          ]);
          logger.info('email_flow_marker', {
            step: 'data_loaded',
            bookingId: booking.id,
            hasBooking: !!fullBooking,
            hasRiderEmail: !!riderMember?.email,
          });
          if (!fullBooking || !riderMember?.email) return;
          await sendTriggeredEmail({
            clubId: ctx.clubId,
            trigger: 'booking_confirmation',
            to: riderMember.email,
            subject: `Booking Confirmed — ${fullBooking.lessonTypeName}`,
            template: React.createElement(BookingConfirmation, {
              riderName: fullBooking.riderName ?? riderMember.displayName ?? '',
              lessonType: fullBooking.lessonTypeName,
              date: String(fullBooking.slotDate),
              time: String(fullBooking.slotStartTime),
              horseName: fullBooking.horseName ?? 'Not yet assigned',
              coachName: slot.coachName ?? 'Not yet assigned',
              arena: fullBooking.arenaName ?? 'Arena',
              clubName: club?.name ?? '',
              clubLogo: '',
              amount: fullBooking.amount ? String(fullBooking.amount) : undefined,
              currency: fullBooking.currency ?? 'AED',
              addToCalendarUrl: '#',
            }),
          });
          logger.info('email_flow_marker', {
            step: 'send_completed',
            bookingId: booking.id,
          });
        } catch (emailErr) {
          logger.error('email_flow_error', {
            bookingId: booking.id,
            error: emailErr instanceof Error ? emailErr.message : String(emailErr),
            stack: emailErr instanceof Error ? emailErr.stack : undefined,
          });
          // Email failure is non-fatal
        }
      });

      return successResponse(booking, 201);
    },
    { requiredPermission: 'bookings:create' },
  );
}
