import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Audit I4 consumer (2026-06-10): `STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES`
 * documents which event types the verifyWebhook switch parses, but until
 * this suite nothing machine-checked that parity. A case added to the
 * switch without updating the set (or vice versa) would only surface as
 * a production `stripe_verify_webhook_unhandled_event_type` info log,
 * or worse, as an envelope with undefined provider fields that
 * applyPaymentWebhook silently no-ops on. This suite is the set's first
 * real consumer and locks parity BOTH ways:
 *
 *   1. Source parity: the `case` labels of the `switch (event.type)`
 *      block are extracted from stripe.ts and compared for exact set
 *      equality. This is the only practical way to assert "the switch
 *      handles NO type outside the set" without enumerating the entire
 *      Stripe event-type union at runtime.
 *   2. Behavioural parity: every type in the set is driven through the
 *      adapter's real public surface (`stripeAdapter.verifyWebhook`)
 *      with a locally signed payload, and must resolve provider fields
 *      without tripping the default branch's unhandled-type log.
 *
 * No network, no Stripe API client: `Stripe.webhooks.constructEvent` is
 * a static crypto helper (HMAC-SHA256 over `${timestamp}.${body}` keyed
 * by the raw `whsec_…` string), so the test signs its own payloads and
 * exercises the genuine signature-verify path end to end.
 */

const { infoMock, warnMock, errorMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: infoMock, warn: warnMock, error: errorMock, debug: vi.fn() },
}));

// Real adapter and real PaymentProviderError: unlike the webhook route
// test (which mocks the adapter away), the adapter IS the unit here.
import { stripeAdapter, STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES } from './stripe';
import { PaymentProviderError } from './types';

const WEBHOOK_SECRET = 'whsec_test_parity_secret';
const PI_ID = 'pi_parity_1';
const BOOKING_ID = 'booking_parity_1';

/**
 * Builds a VerifyWebhookInput whose signature header is genuinely valid
 * for WEBHOOK_SECRET. Format per Stripe's documented scheme:
 * `t=<unix-seconds>,v1=<hex hmac>`, where the HMAC input is
 * `${timestamp}.${rawBody}`. A current timestamp keeps every run inside
 * the adapter's 120s tolerance (F-40), so no fake timers are needed and
 * the test stays deterministic.
 */
function signedInput(eventType: string, dataObject: Record<string, unknown>) {
  const body = JSON.stringify({
    id: `evt_${eventType.replace(/\./g, '_')}`,
    object: 'event',
    type: eventType,
    data: { object: dataObject },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return { body, signatureHeader: `t=${timestamp},v1=${v1}`, webhookSecret: WEBHOOK_SECRET };
}

// Minimal `event.data.object` shapes per handled type, carrying only the
// fields the switch actually reads (id / status / amount_* / currency /
// metadata / payment_intent / refunds). `constructEvent` JSON-parses the
// body without schema validation, so minimal fixtures are faithful to
// what the switch sees in production.
function paymentIntentObject(status: string): Record<string, unknown> {
  return {
    id: PI_ID,
    object: 'payment_intent',
    status,
    amount_received: 1000,
    currency: 'aed',
    metadata: { bookingId: BOOKING_ID },
  };
}

const chargeObject: Record<string, unknown> = {
  id: 'ch_parity_1',
  object: 'charge',
  payment_intent: PI_ID,
  amount: 1000,
  amount_captured: 1000,
  currency: 'aed',
  metadata: { bookingId: BOOKING_ID },
};

const EVENT_FIXTURES: Record<string, Record<string, unknown>> = {
  'payment_intent.succeeded': paymentIntentObject('succeeded'),
  'payment_intent.processing': paymentIntentObject('processing'),
  'payment_intent.payment_failed': paymentIntentObject('requires_payment_method'),
  'payment_intent.canceled': paymentIntentObject('canceled'),
  'payment_intent.requires_action': paymentIntentObject('requires_action'),
  'payment_intent.created': paymentIntentObject('requires_payment_method'),
  'charge.refunded': {
    ...chargeObject,
    refunds: {
      data: [{ id: 're_parity_1', object: 'refund', status: 'succeeded', amount: 500, created: 2 }],
    },
  },
  'charge.succeeded': chargeObject,
  'charge.failed': { ...chargeObject, status: 'failed' },
  'charge.refund.updated': {
    id: 're_parity_2',
    object: 'refund',
    payment_intent: PI_ID,
    status: 'pending',
    amount: 250,
    currency: 'aed',
    metadata: { bookingId: BOOKING_ID },
  },
};

function unhandledTypeLogs() {
  return infoMock.mock.calls.filter(
    ([message]) => message === 'stripe_verify_webhook_unhandled_event_type',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES / verifyWebhook switch parity', () => {
  it('switch case labels match the exported set exactly, both directions (source parity)', () => {
    const source = readFileSync(fileURLToPath(new URL('./stripe.ts', import.meta.url)), 'utf8');

    // Slice from the event-type switch to its `default:` clause. The two
    // status-mapping switches (mapIntentStatus / mapRefundStatus) sit
    // EARLIER in the file, so anchoring on `switch (event.type)` and the
    // first `default:` after it isolates exactly the clause list we care
    // about. The guards below make a refactor of that shape fail loudly
    // instead of letting the regex silently match nothing.
    const switchStart = source.indexOf('switch (event.type)');
    expect(switchStart).toBeGreaterThan(-1);
    const defaultStart = source.indexOf('default:', switchStart);
    expect(defaultStart).toBeGreaterThan(switchStart);

    const clauseRegion = source.slice(switchStart, defaultStart);
    const caseLabels = [...clauseRegion.matchAll(/case\s+'([^']+)':/g)].flatMap((match) => {
      const label = match[1];
      return label === undefined ? [] : [label];
    });

    expect(caseLabels.length).toBeGreaterThan(0);
    // A duplicate case label is unreachable dead code; surface it here.
    expect(new Set(caseLabels).size).toBe(caseLabels.length);
    // Exact set equality. Sorted-array comparison asserts BOTH directions:
    // no switch case missing from the set, no set entry missing a case.
    expect([...caseLabels].sort()).toEqual([...STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES].sort());
  });

  it('behavioural fixture table covers the exported set exactly', () => {
    // Forces whoever adds a type to the set to also add a fixture above,
    // keeping the per-type behavioural assertions honest (a missing key
    // would otherwise skip silently inside it.each).
    expect(Object.keys(EVENT_FIXTURES).sort()).toEqual(
      [...STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES].sort(),
    );
  });

  it.each([...STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES])(
    '%s resolves provider fields without tripping the unhandled-type log',
    async (eventType) => {
      const fixture = EVENT_FIXTURES[eventType];
      if (!fixture) {
        throw new Error(`No fixture for ${eventType}: add it to EVENT_FIXTURES`);
      }

      const envelope = await stripeAdapter.verifyWebhook(signedInput(eventType, fixture));

      expect(envelope.eventType).toBe(eventType);
      // The set's documented contract: every member must resolve a
      // providerPaymentId. An undefined one would make applyPaymentWebhook
      // silently no-op against the booking ledger.
      expect(envelope.providerPaymentId).toBe(PI_ID);
      expect(unhandledTypeLogs()).toEqual([]);
    },
  );
});

describe('verifyWebhook default branch: types outside the set', () => {
  it('emits the structured unhandled-type log and returns a bare envelope', async () => {
    // `invoice.created` is the same canonical not-handled example the
    // webhook route test uses. Sanity-pin that it is genuinely outside
    // the set so this test cannot drift into asserting the wrong branch.
    expect(STRIPE_VERIFY_WEBHOOK_HANDLED_TYPES.has('invoice.created')).toBe(false);

    const envelope = await stripeAdapter.verifyWebhook(
      signedInput('invoice.created', { id: 'in_parity_1', object: 'invoice' }),
    );

    expect(envelope.eventType).toBe('invoice.created');
    expect(envelope.providerPaymentId).toBeUndefined();
    expect(envelope.status).toBeUndefined();
    expect(infoMock).toHaveBeenCalledWith('stripe_verify_webhook_unhandled_event_type', {
      eventType: 'invoice.created',
      eventId: 'evt_invoice_created',
    });
  });

  it('rejects a tampered body with INVALID_SIGNATURE', async () => {
    // If `signedInput` ever stopped producing genuinely valid signatures
    // (or constructEvent stopped verifying), the handled-type tests above
    // would pass vacuously. This negative case proves the crypto path is
    // live: one byte of body drift must invalidate the HMAC.
    const input = signedInput('payment_intent.succeeded', paymentIntentObject('succeeded'));
    const tampered = stripeAdapter.verifyWebhook({ ...input, body: `${input.body} ` });

    await expect(tampered).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(tampered).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });
});
