import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// `booking-payment-timeout` runs every 10 minutes and decides per-stale
// booking whether to (a) reconcile to paid because the provider says it
// succeeded but the webhook never landed, or (b) auto-cancel and release
// the slot. The two race conditions with a late webhook are the whole
// reason this cron exists, and tests below lock them in:
//
//   - RACE A — webhook never landed but money did arrive: provider's
//     getPaymentStatus returns 'succeeded', reconcileBookingMarkPaid
//     wins the CAS → mark paid and DO NOT cancel.
//   - RACE B — webhook landed during the cron's own scan: reconcile or
//     auto-cancel CAS returns null → count as skipped, no double-cancel,
//     no spurious email. Without these CAS gates a paid booking can flip
//     back to cancelled.
//
// Plus the per-booking try/catch isolation (one bad booking does not
// poison the rest of the sweep) and the top-level CRON_FAILED envelope.

const {
  requireCronSecretMock,
  findStaleMock,
  autoCancelMock,
  reconcileMock,
  adminGetAccountMock,
  getClubByIdMock,
  sendEmailMock,
  getAdapterMock,
  getPaymentStatusMock,
  warnMock,
  errorMock,
  infoMock,
} = vi.hoisted(() => ({
  requireCronSecretMock: vi.fn(),
  findStaleMock: vi.fn(),
  autoCancelMock: vi.fn(),
  reconcileMock: vi.fn(),
  adminGetAccountMock: vi.fn(),
  getClubByIdMock: vi.fn(),
  sendEmailMock: vi.fn(),
  getAdapterMock: vi.fn(),
  getPaymentStatusMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({
  requireCronSecret: requireCronSecretMock,
  successResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  errorResponse: (code: string, message: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { code, message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}));

vi.mock('@equestrian/db/queries', () => ({
  findStalePendingPaymentBookings: findStaleMock,
  autoCancelBookingForPaymentTimeout: autoCancelMock,
  reconcileBookingMarkPaid: reconcileMock,
  adminGetActivePaymentAccount: adminGetAccountMock,
  getClubById: getClubByIdMock,
}));

vi.mock('@/lib/email', () => ({
  sendTriggeredEmail: sendEmailMock,
}));

vi.mock('@equestrian/email-templates/booking-cancellation', () => ({
  BookingCancellation: vi.fn(() => '<email/>'),
}));

vi.mock('@/lib/payments/registry', () => ({
  getAdapter: getAdapterMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: warnMock, error: errorMock, info: infoMock, debug: vi.fn() },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: vi.fn() }),
}));

// Real PaymentProviderError so the route's `instanceof` branch is exercised.
import { PaymentProviderError } from '@/lib/payments/types';
import { POST } from './route';

const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_PAYMENT_ID = 'pi_test_abc';

function request(): NextRequest {
  return new NextRequest('https://example.com/api/cron/booking-payment-timeout', {
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

function staleBooking(overrides: Partial<{
  bookingId: string;
  clubId: string;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  isGuestBooking: boolean;
  guestEmail: string | null;
  guestName: string | null;
  riderEmail: string | null;
  riderName: string | null;
}> = {}) {
  // Spread the overrides last so callers can explicitly set fields to
  // `null` (e.g. `riderEmail: null` to exercise the "no recipient" path).
  // `??` would coerce `null` back to the default.
  return {
    bookingId: BOOKING_ID,
    clubId: CLUB_ID,
    paymentProvider: 'stripe',
    providerPaymentId: PROVIDER_PAYMENT_ID,
    isGuestBooking: false,
    guestEmail: null,
    guestName: null,
    riderEmail: 'rider@example.com',
    riderName: 'Test Rider',
    lessonTypeName: 'Dressage',
    slotDate: '2026-05-20',
    slotStartTime: '10:00',
    arenaName: 'Main Arena',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Permissive defaults — authorized cron, empty sweep.
  requireCronSecretMock.mockResolvedValue(undefined);
  findStaleMock.mockResolvedValue([]);
  adminGetAccountMock.mockResolvedValue({
    provider: 'stripe',
    externalAccountId: 'acct_test',
  });
  getAdapterMock.mockReturnValue({ getPaymentStatus: getPaymentStatusMock });
  getPaymentStatusMock.mockResolvedValue({ status: 'pending' });
  autoCancelMock.mockResolvedValue({ bookingId: BOOKING_ID });
  reconcileMock.mockResolvedValue({ bookingId: BOOKING_ID });
  getClubByIdMock.mockResolvedValue({
    id: CLUB_ID,
    name: 'Test Club',
    logoUrl: null,
  });
  sendEmailMock.mockResolvedValue({ sent: true, skipped: false });
});

async function readJson(res: Response): Promise<{
  success: boolean;
  data?: { considered: number; reconciledPaid: number; autoCancelled: number; skipped: number; errors: number };
  error?: { code: string; message: string };
}> {
  return res.json();
}

describe('authorization', () => {
  it('short-circuits to whatever requireCronSecret returns when unauthorized', async () => {
    requireCronSecretMock.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(findStaleMock).not.toHaveBeenCalled();
  });
});

describe('empty sweep', () => {
  it('returns zero counters when no stale bookings exist', async () => {
    const res = await POST(request());
    const body = await readJson(res);

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      considered: 0,
      reconciledPaid: 0,
      autoCancelled: 0,
      skipped: 0,
      errors: 0,
    });
    expect(autoCancelMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});

describe('RACE A — webhook never landed but money DID arrive', () => {
  it('provider says succeeded → reconcile + counted as reconciledPaid + no auto-cancel + no email', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'succeeded' });
    reconcileMock.mockResolvedValueOnce({ bookingId: BOOKING_ID });

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({
      considered: 1,
      reconciledPaid: 1,
      autoCancelled: 0,
      skipped: 0,
      errors: 0,
    });
    expect(reconcileMock).toHaveBeenCalledWith(CLUB_ID, BOOKING_ID);
    expect(autoCancelMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('reconcile CAS lost (concurrent webhook beat us) → skipped++, NOT double-counted as reconciledPaid', async () => {
    // RACE B variant within Race A's branch: the webhook landed while
    // we were calling getPaymentStatus, so reconcileBookingMarkPaid's
    // CAS returns null. The booking is already paid — do nothing.
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'succeeded' });
    reconcileMock.mockResolvedValueOnce(null);

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({
      considered: 1,
      reconciledPaid: 0,
      autoCancelled: 0,
      skipped: 1,
    });
    expect(autoCancelMock).not.toHaveBeenCalled();
  });
});

describe('Step 1 → Step 2 fall-through', () => {
  it('provider says pending → falls through to auto-cancel', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({ autoCancelled: 1, reconciledPaid: 0 });
    expect(autoCancelMock).toHaveBeenCalledWith(
      CLUB_ID,
      BOOKING_ID,
      expect.stringContaining('grace window'),
    );
  });

  it('booking has no providerPaymentId → skips step 1 entirely, goes straight to auto-cancel', async () => {
    findStaleMock.mockResolvedValueOnce([
      staleBooking({ providerPaymentId: null, paymentProvider: null }),
    ]);

    const body = await readJson(await POST(request()));

    expect(adminGetAccountMock).not.toHaveBeenCalled();
    expect(getPaymentStatusMock).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ autoCancelled: 1 });
  });

  it('club switched providers since booking was minted → skips status check, auto-cancels', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking({ paymentProvider: 'ziina' })]);
    adminGetAccountMock.mockResolvedValueOnce({
      provider: 'stripe', // active provider differs from booking's
      externalAccountId: 'acct_test',
    });

    const body = await readJson(await POST(request()));

    expect(getPaymentStatusMock).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ autoCancelled: 1 });
  });

  it('PaymentProviderError from getPaymentStatus → logged + falls through to auto-cancel (does not throw)', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockRejectedValueOnce(
      new PaymentProviderError('PROVIDER_DOWN', 'stripe 503'),
    );

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({ autoCancelled: 1, errors: 0 });
    expect(warnMock).toHaveBeenCalledWith(
      'booking_payment_timeout_provider_status_failed',
      expect.objectContaining({ code: 'PROVIDER_DOWN' }),
    );
  });

  it('non-PaymentProviderError from getPaymentStatus → rethrows, caught by per-booking try, errors++', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockRejectedValueOnce(new TypeError('unexpected null'));

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({ errors: 1, autoCancelled: 0, reconciledPaid: 0 });
    expect(autoCancelMock).not.toHaveBeenCalled();
  });
});

describe('RACE B — webhook landed between query and update', () => {
  it('autoCancel CAS returns null → skipped++, no email sent, no spurious counter bump', async () => {
    // Same booking the webhook just flipped to paid. The CAS guard
    // (`status='confirmed' AND paymentStatus='pending'`) rejects the
    // cancel, returning null. Email MUST NOT go out — the booking is
    // legitimately paid.
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });
    autoCancelMock.mockResolvedValueOnce(null);

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({
      autoCancelled: 0,
      skipped: 1,
      reconciledPaid: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('cancellation email', () => {
  it('happy path sends to rider email/name on a member booking', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });

    await POST(request());

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clubId: CLUB_ID,
        trigger: 'booking_cancellation',
        to: 'rider@example.com',
      }),
    );
  });

  it('guest booking routes the email to guestEmail with guestName', async () => {
    findStaleMock.mockResolvedValueOnce([
      staleBooking({
        isGuestBooking: true,
        guestEmail: 'guest@example.com',
        guestName: 'Guest Joe',
      }),
    ]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });

    await POST(request());

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.com' }),
    );
  });

  it('cancel proceeds even when there is no recipient email — just skips the send', async () => {
    findStaleMock.mockResolvedValueOnce([
      staleBooking({ riderEmail: null }),
    ]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({ autoCancelled: 1 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('cancel proceeds even when the club row vanished between query and email send', async () => {
    findStaleMock.mockResolvedValueOnce([staleBooking()]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });
    getClubByIdMock.mockResolvedValueOnce(null);

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({ autoCancelled: 1 });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      'booking_payment_timeout_email_skipped_no_club',
      expect.any(Object),
    );
  });
});

describe('per-booking isolation', () => {
  it('one booking failing does not poison the rest of the sweep', async () => {
    const goodBooking = staleBooking({ bookingId: 'good-booking' });
    const badBooking = staleBooking({ bookingId: 'bad-booking' });
    findStaleMock.mockResolvedValueOnce([badBooking, goodBooking]);
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });
    getPaymentStatusMock.mockResolvedValueOnce({ status: 'pending' });
    autoCancelMock.mockRejectedValueOnce(new Error('db conflict on first row'));
    autoCancelMock.mockResolvedValueOnce({ bookingId: 'good-booking' });

    const body = await readJson(await POST(request()));

    expect(body.data).toMatchObject({
      considered: 2,
      autoCancelled: 1,
      errors: 1,
    });
  });

  it('caches the club lookup across bookings (only one getClubById call for N same-club bookings)', async () => {
    findStaleMock.mockResolvedValueOnce([
      staleBooking({ bookingId: 'b1' }),
      staleBooking({ bookingId: 'b2' }),
    ]);
    getPaymentStatusMock.mockResolvedValue({ status: 'pending' });

    await POST(request());

    expect(getClubByIdMock).toHaveBeenCalledTimes(1);
  });
});

describe('top-level failure', () => {
  it('findStalePendingPaymentBookings throwing → 500 CRON_FAILED envelope', async () => {
    findStaleMock.mockRejectedValueOnce(new Error('neon outage'));

    const res = await POST(request());
    const body = await readJson(res);

    expect(res.status).toBe(500);
    expect(body.error).toMatchObject({ code: 'CRON_FAILED' });
    expect(errorMock).toHaveBeenCalledWith(
      'booking_payment_timeout_cron_failed',
      expect.objectContaining({ error: 'neon outage' }),
    );
  });
});
