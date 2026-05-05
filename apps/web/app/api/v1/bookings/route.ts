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
  getHorseById,
  isParentOf,
  getDependentMemberIds,
} from '@equestrian/db/queries';
import { matchHorsesToRider } from '@equestrian/shared/utils';
import {
  withAuth,
  successResponse,
  paginatedResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
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

      const canReadAll = hasPermission(ctx.orgRole, 'bookings:read');
      const canReadOwn = hasPermission(ctx.orgRole, 'bookings:read_own');
      const canReadChild = hasPermission(ctx.orgRole, 'bookings:read_child');

      if (!canReadAll && !canReadOwn && !canReadChild) {
        return errorResponse('FORBIDDEN', 'You do not have permission to view bookings', 403);
      }

      // Riders MUST be scoped to their own memberId; parents may also query
      // any rider whose `rider_profiles.parent_member_id` points at them.
      // The parent-child relation lives on rider_profiles (audit H-7), not
      // club_members, so the audit's earlier "schema doesn't model it" note
      // missed this column.
      let riderMemberIdFilter = filters.riderMemberId;
      let riderMemberIdsFilter: string[] | undefined;

      if (!canReadAll) {
        if (!ctx.memberId) {
          return errorResponse('NO_MEMBER', 'Member profile not found. Contact your club admin.', 403);
        }

        if (filters.riderMemberId) {
          const isSelf = filters.riderMemberId === ctx.memberId;
          if (!isSelf) {
            const isDependent =
              canReadChild &&
              (await isParentOf(ctx.clubId, ctx.memberId, filters.riderMemberId));
            if (!isDependent) {
              return errorResponse('FORBIDDEN', 'You can only view your own bookings', 403);
            }
          }
          // riderMemberIdFilter passes through unchanged.
        } else if (canReadChild) {
          // Parent without a specific filter — expand to (self + dependents)
          // so a single GET surfaces every booking the parent is responsible
          // for. Riders/owners (no read_child grant) fall through to the
          // self-only branch below.
          const dependents = await getDependentMemberIds(ctx.clubId, ctx.memberId);
          riderMemberIdsFilter = [ctx.memberId, ...dependents];
          riderMemberIdFilter = undefined;
        } else {
          riderMemberIdFilter = ctx.memberId;
        }
      }

      const effectiveFilters = {
        ...filters,
        riderMemberId: riderMemberIdFilter,
        riderMemberIds: riderMemberIdsFilter,
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
      // Permission gate. Accepts either the staff `bookings:create` grant
      // OR the parent `bookings:create_child` grant — the body check below
      // narrows parents to riders linked to them as a guardian via
      // `rider_profiles.parent_member_id` (audit H-7). The previous
      // implementation accepted parents at the gate but blocked them in
      // the body because `canBookForOthers` required staff-only perms.
      const canCreateAny = hasPermission(ctx.orgRole, 'bookings:create');
      const canCreateChild = hasPermission(ctx.orgRole, 'bookings:create_child');
      if (!canCreateAny && !canCreateChild) {
        return errorResponse('FORBIDDEN', 'You do not have permission to create bookings', 403);
      }

      const data = await parseRequiredBody(request, createBookingSchema);

      // Audit CRIT-3 (2026-05-05): the booking row's `payment_method` enum
      // declares `'package_credit'`, but no code anywhere decrements
      // `rider_packages.remaining_credits`. Until the consumption path
      // ships (FOR-UPDATE lock on the rider's active package, atomic
      // decrement inside the booking writeTransaction, rollback on
      // depletion), accepting it here would let any rider with
      // `bookings:create` book free lessons. Reject at the route until
      // that work lands.
      if (data.paymentMethod === 'package_credit') {
        return errorResponse(
          'NOT_IMPLEMENTED',
          'Package-credit booking is not yet enabled. Pick a different payment method.',
          422,
        );
      }

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

      const isSelf = data.riderMemberId === ctx.memberId;
      // Staff who can both create and read can book for any rider in the
      // club. Pure `bookings:create` (rider role) only authorizes self
      // bookings — guests are attached to the booker's row, not booked
      // under a fresh memberId.
      const canBookForAnyone =
        canCreateAny && hasPermission(ctx.orgRole, 'bookings:read');

      if (!isSelf) {
        if (!canBookForAnyone && !canCreateChild) {
          return errorResponse('FORBIDDEN', 'You can only create bookings for yourself', 403);
        }

        // Verify the named rider is a member of *this* club. The
        // bookings.rider_member_id FK only points at club_members.id (no
        // compound (id, club_id) constraint), so a forged UUID from Club B
        // would otherwise insert cleanly.
        const targetRider = await getMemberById(ctx.clubId, data.riderMemberId);
        if (!targetRider) {
          return errorResponse('RIDER_NOT_FOUND', 'Rider is not a member of this club', 404);
        }
        // Audit MED (2026-05-05 pass 2): `getMemberById` returns rows
        // regardless of `isActive`. Booking lessons for a deactivated
        // rider produced a confirmed booking the rider couldn't see and
        // bypassed the deactivate-flow's intent. Sibling check in the
        // medication-logs route already filters this; mirror it here.
        if (!targetRider.isActive) {
          return errorResponse(
            'RIDER_INACTIVE',
            'This rider is deactivated and cannot be booked. Reactivate the rider first.',
            422,
          );
        }

        if (!canBookForAnyone) {
          // Parent-only path — verify the target is recorded as their
          // dependent on the rider profile. Without this, the
          // `bookings:create_child` grant would let any parent book for
          // any rider in the club.
          const linked = await isParentOf(ctx.clubId, ctx.memberId, data.riderMemberId);
          if (!linked) {
            return errorResponse(
              'FORBIDDEN',
              'You can only book lessons for riders linked to you as a guardian',
              403,
            );
          }
        }
      }

      const isGuestBooking = !!data.guest;

      // Audit CRIT-1 (2026-05-05): bind the body's horseId to this club
      // before forwarding to createBooking. The `bookings.horse_id` FK
      // is single-column → references `horses(id)` only, with no
      // `(horse_id, club_id)` composite constraint (migration 0017
      // applied that pattern to horse SUB-tables but not to bookings
      // itself). Without this guard, a Club A staffer could POST
      // `{ slotId: <A>, horseId: <B-horse-uuid> }` and the DB would
      // accept the row. Migration 0033 adds the composite FK as
      // belt-and-braces; this route check is the immediate defence.
      // Soft-deleted horses are also filtered (`isNull(deletedAt)` in
      // getHorseById) so a "deleted" club B horse can't be smuggled.
      if (data.horseId) {
        const horse = await getHorseById(ctx.clubId, data.horseId);
        if (!horse) {
          return errorResponse(
            'HORSE_NOT_FOUND',
            'Horse is not in this club',
            404,
          );
        }
      }

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
          currency: slot.lessonTypeCurrency,
          riderMemberId: data.riderMemberId,
          // Audit H-4: pass lesson type so coupons with `applicableTypes`
          // restriction are honoured.
          lessonType: slot.lessonTypeType,
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
          // Pass the pre-discount value when a coupon is in play — the
          // post-lock TOCTOU recompute inside `createBooking` derives the
          // final amount/discount from the LOCKED coupon's effective
          // values (audit MED, 2026-05-05 pass 2). For the no-coupon
          // path, `amount` is used directly.
          amount: netAmount,
          grossAmount: couponId ? grossAmount : undefined,
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
      // Permission gate is inline above — accepts both `bookings:create`
      // (staff/rider) and `bookings:create_child` (parent), and narrows
      // each role to the riders they're allowed to book for. Audit B-1.
      // Rate-limit booking creation per user. The /coupons/validate route
      // is rate-limited (10/min, failClosed) to defeat coupon-code
      // enumeration, but a brute-forcer could otherwise just hit this
      // endpoint with `{ slotId, couponCode: 'GUESS_X' }` 1000× and read
      // the success/failure on the booking — see audit B-23. 30/min lets
      // legitimate burst-booking through (e.g. an admin batch-creating)
      // while still capping the brute-force surface. failClosed (audit
      // AI-45) — bookings consume slot capacity; must not be lifted on a
      // limiter outage.
      rateLimit: { maxRequests: 30, windowMs: 60_000, failClosed: true },
      routeKey: 'bookings:create',
    },
  );
}
