import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Per-club Stripe webhook is one of the highest-blast-radius surfaces
// in the codebase — a bug here silently double-credits or drops real
// money. Tests here lock in:
//
//   - QA-15 uniform 401 across no-account / no-secret / invalid-sig
//     paths so an attacker with a leaked clubId can't probe whether
//     a club has connected Stripe (response-shape oracle).
//   - F-15 (2026-05-07 r4) top-level catch wraps any unhandled throw
//     into a static "Internal error" 500 so stack traces don't leak.
//   - F-19 (2026-05-07 r5) escalation: when neither the booking nor
//     the livery helper resolves the event, mark the dedup row
//     permanently_failed instead of silently flipping to processed.
//   - F-12 (2026-05-08 r6) IP-keyed rate limit guards the body-cap →
//     DB-lookup → AES-GCM-decrypt → HMAC pipeline from clubId floods.
//   - F-38 account-id mismatch defense (Connect path defense-in-depth).
//
// Pattern is the same shape as lib/tenant.test.ts and is intentionally
// reusable for the other 4 webhook receivers (ziina/[clubId],
// ziina-platform, n-genius, clerk).

const {
  rateLimitMock,
  getClientIpMock,
  readWebhookBodyMock,
  getWebhookConfigMock,
  verifyWebhookMock,
  applyPaymentWebhookMock,
  applyLiveryInvoiceWebhookMock,
  claimWebhookEventMock,
  markProcessedMock,
  markFailedMock,
  markPermanentlyFailedMock,
  warnMock,
  errorMock,
  infoMock,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  readWebhookBodyMock: vi.fn(),
  getWebhookConfigMock: vi.fn(),
  verifyWebhookMock: vi.fn(),
  applyPaymentWebhookMock: vi.fn(),
  applyLiveryInvoiceWebhookMock: vi.fn(),
  claimWebhookEventMock: vi.fn(),
  markProcessedMock: vi.fn(),
  markFailedMock: vi.fn(),
  markPermanentlyFailedMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: rateLimitMock,
}));

vi.mock('@/lib/request-ip', () => ({
  getClientIp: getClientIpMock,
}));

vi.mock('@/lib/payments/webhook-body', () => ({
  readWebhookBody: readWebhookBodyMock,
  WEBHOOK_BODY_CAPS: { stripe: 1_000_000, ziina: 1_000_000, n_genius: 1_000_000 },
}));

vi.mock('@equestrian/db/queries', () => ({
  getWebhookConfigByClubProvider: getWebhookConfigMock,
  claimWebhookEvent: claimWebhookEventMock,
  markWebhookEventProcessed: markProcessedMock,
  markWebhookEventFailed: markFailedMock,
  markWebhookEventPermanentlyFailed: markPermanentlyFailedMock,
}));

vi.mock('@/lib/payments/stripe', () => ({
  stripeAdapter: { verifyWebhook: verifyWebhookMock },
}));

vi.mock('@/lib/payments/webhook-helpers', () => ({
  applyPaymentWebhook: applyPaymentWebhookMock,
  applyLiveryInvoiceWebhook: applyLiveryInvoiceWebhookMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: warnMock, error: errorMock, info: infoMock, debug: vi.fn() },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: vi.fn() }),
}));

// Real PaymentProviderError — the route uses `instanceof` to branch
// INVALID_SIGNATURE from other verify errors, so we need the actual class.
import { PaymentProviderError } from '@/lib/payments/types';
import { POST } from './route';

const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = 'evt_test_123';
const PROVIDER_PAYMENT_ID = 'pi_test_abc';
const WEBHOOK_SECRET = 'whsec_test_secret';

function makeRequest(opts: {
  body?: string;
  signature?: string | null;
  clubId?: string;
} = {}): NextRequest {
  const headers = new Headers();
  if (opts.signature !== null && opts.signature !== undefined) {
    headers.set('stripe-signature', opts.signature);
  }
  const body = opts.body ?? '{}';
  headers.set('content-length', String(body.length));
  return new NextRequest(
    `https://example.com/api/webhooks/stripe/${opts.clubId ?? CLUB_ID}`,
    { method: 'POST', headers, body },
  );
}

function call(req: NextRequest, clubId: string = CLUB_ID) {
  return POST(req, { params: Promise.resolve({ clubId }) });
}

function makeEvent(
  overrides: Partial<{
    eventType: string;
    eventId: string;
    providerPaymentId: string;
    providerAccountId: string | null;
  }> = {},
) {
  return {
    eventType: overrides.eventType ?? 'payment_intent.succeeded',
    eventId: overrides.eventId ?? EVENT_ID,
    providerPaymentId: overrides.providerPaymentId ?? PROVIDER_PAYMENT_ID,
    providerAccountId: overrides.providerAccountId ?? null,
    raw: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Permissive defaults — each test overrides one knob to exercise its branch.
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
  getClientIpMock.mockReturnValue('192.0.2.1');
  readWebhookBodyMock.mockResolvedValue('{"raw":"body"}');
  getWebhookConfigMock.mockResolvedValue({
    webhookSigningSecret: WEBHOOK_SECRET,
    externalAccountId: null,
  });
  verifyWebhookMock.mockResolvedValue(makeEvent());
  claimWebhookEventMock.mockResolvedValue({ status: 'claimed', attempt: 1 });
  applyPaymentWebhookMock.mockResolvedValue({ kind: 'matched' });
  applyLiveryInvoiceWebhookMock.mockResolvedValue(null);
});

describe('rate limit', () => {
  it('returns 429 and does not touch downstream when over the IP-keyed cap', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 });

    const res = await call(makeRequest());

    expect(res.status).toBe(429);
    expect(getWebhookConfigMock).not.toHaveBeenCalled();
    expect(verifyWebhookMock).not.toHaveBeenCalled();
  });
});

describe('signature verification — all rejection paths return the QA-15 uniform 401', () => {
  it('rejects when stripe-signature header is missing', async () => {
    const res = await call(makeRequest({ signature: null }));

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe('Invalid signature');
    expect(verifyWebhookMock).not.toHaveBeenCalled();
  });

  it('rejects with the SAME 401 shape when the club has no Stripe account connected', async () => {
    getWebhookConfigMock.mockResolvedValueOnce(null);

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe('Invalid signature');
    expect(verifyWebhookMock).not.toHaveBeenCalled();
  });

  it('rejects with the SAME 401 shape when the account row has no webhook secret', async () => {
    getWebhookConfigMock.mockResolvedValueOnce({
      webhookSigningSecret: null,
      externalAccountId: null,
    });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe('Invalid signature');
    expect(verifyWebhookMock).not.toHaveBeenCalled();
  });

  it('rejects when stripeAdapter throws INVALID_SIGNATURE', async () => {
    verifyWebhookMock.mockRejectedValueOnce(
      new PaymentProviderError('INVALID_SIGNATURE', 'bad sig'),
    );

    const res = await call(makeRequest({ signature: 'sig_v1=bad' }));

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe('Invalid signature');
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
  });

  it('fail-closes (401, no downstream call) when verifyWebhook throws an unexpected error', async () => {
    verifyWebhookMock.mockRejectedValueOnce(new Error('stripe SDK exploded'));

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe('Invalid signature');
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
  });

  it('rejects when the event account id disagrees with the stored externalAccountId (F-38)', async () => {
    getWebhookConfigMock.mockResolvedValueOnce({
      webhookSigningSecret: WEBHOOK_SECRET,
      externalAccountId: 'acct_legitimate',
    });
    verifyWebhookMock.mockResolvedValueOnce(
      makeEvent({ providerAccountId: 'acct_attacker' }),
    );

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(401);
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
  });
});

describe('event-type filter', () => {
  it('200s without claiming the event when the type is not in HANDLED_EVENTS', async () => {
    verifyWebhookMock.mockResolvedValueOnce(
      makeEvent({ eventType: 'invoice.created' }),
    );

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('OK');
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
    expect(applyPaymentWebhookMock).not.toHaveBeenCalled();
  });
});

describe('idempotency via claimWebhookEvent', () => {
  it('returns 200 without re-applying when the event was already_processed', async () => {
    claimWebhookEventMock.mockResolvedValueOnce({ status: 'already_processed' });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('OK');
    expect(applyPaymentWebhookMock).not.toHaveBeenCalled();
    expect(markProcessedMock).not.toHaveBeenCalled();
  });

  it('returns 503 when another worker is in_flight on the same event', async () => {
    claimWebhookEventMock.mockResolvedValueOnce({ status: 'in_flight' });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(503);
    expect(applyPaymentWebhookMock).not.toHaveBeenCalled();
  });

  it('returns 200 and does not retry when the event is permanently_failed', async () => {
    claimWebhookEventMock.mockResolvedValueOnce({ status: 'permanently_failed' });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    expect(applyPaymentWebhookMock).not.toHaveBeenCalled();
  });
});

describe('happy paths', () => {
  it('payment_intent.succeeded with a matched booking → markProcessed + 200', async () => {
    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    expect(applyPaymentWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        overrideClubId: CLUB_ID,
        isRefundEvent: false,
      }),
    );
    expect(applyLiveryInvoiceWebhookMock).not.toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalledWith('stripe', EVENT_ID);
    expect(markPermanentlyFailedMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
  });

  it('charge.refunded is forwarded as isRefundEvent=true', async () => {
    verifyWebhookMock.mockResolvedValueOnce(
      makeEvent({ eventType: 'charge.refunded' }),
    );

    await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(applyPaymentWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({ isRefundEvent: true }),
    );
  });

  it('booking helper signals permanentFailureReason → markPermanentlyFailed (audit MED 2026-05-05)', async () => {
    applyPaymentWebhookMock.mockResolvedValueOnce({
      kind: 'matched',
      permanentFailureReason: 'Paid event for cancelled booking',
    });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    expect(markPermanentlyFailedMock).toHaveBeenCalledWith(
      'stripe',
      EVENT_ID,
      'Paid event for cancelled booking',
    );
    expect(markProcessedMock).not.toHaveBeenCalled();
  });

  it('booking no_target → falls through to livery invoice helper; when that matches, markProcessed', async () => {
    applyPaymentWebhookMock.mockResolvedValueOnce({ kind: 'no_target' });
    applyLiveryInvoiceWebhookMock.mockResolvedValueOnce({ kind: 'matched' });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    expect(applyLiveryInvoiceWebhookMock).toHaveBeenCalled();
    expect(markProcessedMock).toHaveBeenCalledWith('stripe', EVENT_ID);
    expect(markPermanentlyFailedMock).not.toHaveBeenCalled();
  });

  it('F-19 escalation: both helpers return no_target → markPermanentlyFailed, not markProcessed', async () => {
    // Pre-fix the route silently flipped dedup to `processed` here and
    // we'd lose every misrouted webhook with no operator signal.
    applyPaymentWebhookMock.mockResolvedValueOnce({ kind: 'no_target' });
    applyLiveryInvoiceWebhookMock.mockResolvedValueOnce({ kind: 'no_target' });

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(200);
    expect(markPermanentlyFailedMock).toHaveBeenCalledWith(
      'stripe',
      EVENT_ID,
      expect.stringContaining(PROVIDER_PAYMENT_ID),
    );
    expect(markProcessedMock).not.toHaveBeenCalled();
  });
});

describe('failure paths', () => {
  it('applyPaymentWebhook throws → markFailed + 500 "Processing failed"', async () => {
    applyPaymentWebhookMock.mockRejectedValueOnce(new Error('DB went sideways'));

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toBe('Processing failed');
    expect(markFailedMock).toHaveBeenCalledWith(
      'stripe',
      EVENT_ID,
      'DB went sideways',
    );
    expect(markProcessedMock).not.toHaveBeenCalled();
  });

  it('F-15 top-level catch: unhandled throw before claim → 500 "Internal error" (sanitized, no stack leak)', async () => {
    readWebhookBodyMock.mockRejectedValueOnce(new Error('boom with sensitive stack'));

    const res = await call(makeRequest({ signature: 'sig_v1=abc' }));

    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toBe('Internal error');
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
  });
});
