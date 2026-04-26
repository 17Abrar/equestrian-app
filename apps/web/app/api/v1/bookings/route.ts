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

      // Security: riders can only book for themselves (or for guests under
      // their own account — guest bookings still attach `riderMemberId` to
      // the booker as the payer of record).
      const canBookForOthers = hasPermission(ctx.orgRole, 'bookings:create') && hasPermission(ctx.orgRole, 'bookings:read');
      if (!canBookForOthers && data.riderMemberId !== ctx.memberId) {
        return errorResponse('FORBIDDEN', 'You can only create bookings for yourself', 403);
      }

      // Staff booking for someone else — verify the named rider is a
      // member of *this* club. The bookings.rider_member_id FK only points
      // at club_members.id (no compound (id, club_id) constraint), so a
      // forged UUID from Club B would otherwise insert cleanly.
      if (canBookForOthers && data.riderMemberId !== ctx.memberId) {
        const targetRider = await getMemberById(ctx.clubId, data.riderMemberId);
        if (!targetRider) {
          return errorResponse('RIDER_NOT_FOUND', 'Rider is not a member of this club', 404);
        }
      }

      const isGuestBooking = !!data.guest;

      let assignedHorseId = data.horseId;
      let matchScore: number | undefined;
      let wasAutoMatched = false;

      // Run smart horse matching if no horse specified and auto-match is
      // enabled. Skipped for guest bookings — we only know their self-
      // reported skill level, not weight/height, so automatic matching on
      // physical criteria would be unreliable. Staff can assign a horse
      // manually after the booking is confirmed.
      if (!assignedHorseId && data.autoMatchHorse && !isGuestBooking) {
        const rider = await getRiderByMemberId(ctx.clubId, data.riderMemberId);

        if (rider && rider.weightKg && rider.heightCm) {
          const availableHorses = await getAvailableHorsesForMatching(
            ctx.clubId,
            slot.date,
            // Filter pairing history to this rider only (audit G-14) —
            // the matching algorithm only scores against the calling
            // rider's prior pairings, so loading every (rider, horse,
            // rating) tuple in the club's history was wasted work.
            data.riderMemberId,
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
          // Only auto-assign when the top match carries no warnings.
          // Skill-above-rider, weight-near-limit, past-pairing-issues etc.
          // leave `horseId` null and fall through to manual assignment by
          // staff — the alternative is silently putting a beginner on an
          // advanced horse because the algorithm still ranked it first.
          if (topMatch && topMatch.warnings.length === 0) {
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
          } else if (topMatch) {
            logger.info('horse_auto_match_skipped_with_warnings', {
              clubId: ctx.clubId,
              riderId: data.riderMemberId,
              candidateHorseId: topMatch.horse.id,
              score: topMatch.score,
              warnings: topMatch.warnings,
            });
          }
        }
      }

      // Apply coupon if provided. Price comes from the lesson type — never
      // accept it from the request body, otherwise a rider could POST
      // `{ amount: 1 }` and pay 1 fil for a full-price lesson.
      const grossAmount = slot.lessonTypePrice;
      let discountAmount = 0;
      let couponId: string | undefined;

      if (data.couponCode) {
        const couponResult = await validateCoupon({
          clubId: ctx.clubId,
          code: data.couponCode,
          amount: grossAmount,
          riderMemberId: data.riderMemberId,
        });

        if (!couponResult.valid) {
          return errorResponse('INVALID_COUPON', couponResult.error ?? 'Invalid coupon', 422);
        }

        discountAmount = couponResult.discount;
        couponId = couponResult.couponId;
      }

      // booking.amount stores the NET amount actually charged. discountAmount
      // is kept alongside as an audit trail so reports can show "saved X".
      // Refund cap and Stripe charge both naturally read booking.amount.
      const netAmount = Math.max(0, grossAmount - discountAmount);

      let booking;
      try {
        booking = await createBooking(ctx.clubId, {
          slotId: data.slotId,
          riderMemberId: data.riderMemberId,
          horseId: assignedHorseId,
          bookedByMemberId: ctx.memberId,
          amount: netAmount,
          currency: slot.lessonTypeCurrency,
          paymentMethod: data.paymentMethod,
          discountAmount,
          couponId,
          status: 'confirmed',
          horseMatchAuto: wasAutoMatched,
          horseMatchScore: matchScore,
          isGuestBooking,
          guestName: data.guest?.name ?? null,
          guestEmail: data.guest?.email ?? null,
          guestPhone: data.guest?.phone ?? null,
          guestSkillLevel: data.guest?.skillLevel ?? null,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'SLOT_FULL') {
          return errorResponse('SLOT_FULL', 'This slot is now full', 409);
        }
        // Coupon gates re-checked under FOR UPDATE in createBooking. These
        // surface only when validateCoupon's pre-flight passed but a
        // concurrent booking by the same rider (or any rider against a
        // global maxUses) consumed the remaining quota in between.
        if (err instanceof Error) {
          if (err.message === 'COUPON_NOT_FOUND') {
            return errorResponse('INVALID_COUPON', 'Promo code is no longer valid', 422);
          }
          if (err.message === 'COUPON_MAX_USES_REACHED') {
            return errorResponse(
              'INVALID_COUPON',
              'This promo code has reached its maximum uses',
              422,
            );
          }
          if (err.message === 'COUPON_RIDER_MAX_USES_REACHED') {
            return errorResponse(
              'INVALID_COUPON',
              'You have already used this promo code',
              422,
            );
          }
        }
        // Catch unique-index violations from idx_bookings_unique_rider_slot
        // and idx_bookings_unique_guest_slot. Postgres raises 23505 for these.
        const pgCode = (err as { code?: string } | null)?.code;
        const msg = err instanceof Error ? err.message : '';
        if (pgCode === '23505' || msg.includes('idx_bookings_unique')) {
          if (isGuestBooking) {
            return errorResponse(
              'GUEST_ALREADY_BOOKED',
              'This guest is already booked for that slot.',
              409,
            );
          }
          return errorResponse(
            'ALREADY_BOOKED',
            'You already have a booking for this lesson. To bring someone else, book them as a guest instead.',
            409,
          );
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
      after(async () => {
        try {
          const [fullBooking, riderMember, club] = await Promise.all([
            getBookingById(ctx.clubId, booking.id),
            getMemberById(ctx.clubId, booking.riderMemberId),
            getClubById(ctx.clubId),
          ]);
          if (!fullBooking || !riderMember?.email) return;
          await sendTriggeredEmail({
            clubId: ctx.clubId,
            trigger: 'booking_confirmation',
            to: riderMember.email,
            subject: fullBooking.isGuestBooking
              ? `Guest Booking Confirmed — ${fullBooking.lessonTypeName}`
              : `Booking Confirmed — ${fullBooking.lessonTypeName}`,
            template: React.createElement(BookingConfirmation, {
              // For guest bookings, the email is addressed to the booker/payer
              // and the guest's name is rendered inside as the actual rider.
              riderName: fullBooking.riderName ?? riderMember.displayName ?? '',
              guestName: fullBooking.isGuestBooking
                ? (fullBooking.guestName ?? undefined)
                : undefined,
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
              // addToCalendarUrl omitted until the ICS-generation feature
              // ships — see audit D-4. Template now hides the button when
              // unset rather than rendering it with a dead `#` href.
            }),
          });
        } catch (emailErr) {
          logger.error('booking_confirmation_email_failed', {
            bookingId: booking.id,
            error: emailErr instanceof Error ? emailErr.message : String(emailErr),
            stack: emailErr instanceof Error ? emailErr.stack : undefined,
          });
        }
      });

      return successResponse(booking, 201);
    },
    {
      requiredPermission: 'bookings:create',
      // Rate-limit booking creation per user. The /coupons/validate route
      // is rate-limited (10/min, failClosed) to defeat coupon-code
      // enumeration, but a brute-forcer could otherwise just hit this
      // endpoint with `{ slotId, couponCode: 'GUESS_X' }` 1000× and read
      // the success/failure on the booking — see audit B-23. 30/min lets
      // legitimate burst-booking through (e.g. an admin batch-creating)
      // while still capping the brute-force surface.
      rateLimit: { maxRequests: 30, windowMs: 60_000 },
      routeKey: 'bookings:create',
    },
  );
}
