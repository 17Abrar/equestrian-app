import { describe, it, expect, vi } from 'vitest';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from './webhook-body';

/**
 * Audit 2026-05-13 (P1): unit tests for the webhook body-size cap.
 * Per-provider caps gate the JSON.parse + HMAC-SHA256 hashing that
 * runs before signature verify; without the cap, an attacker can
 * burn Worker CPU with a 10MB payload that we'll ultimately reject.
 *
 * Two failure modes the cap closes:
 *   - declared content-length over the cap → 413 before reading the body
 *   - actual UTF-8 bytes (after read) over the cap → 413 + log
 *
 * Audit LOW-3: byte counting uses `Buffer.byteLength(body, 'utf8')`
 * because `.length` returns UTF-16 code units (optimistic for
 * emoji/CJK payloads).
 */

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function makeRequest(body: string, contentLength?: number): Request {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  }
  return new Request('https://example.com/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

describe('readWebhookBody', () => {
  it('returns the body string when both declared and actual size are within the cap', async () => {
    const body = JSON.stringify({ event: 'payment_intent.succeeded' });
    const req = makeRequest(body, Buffer.byteLength(body, 'utf8'));
    const result = await readWebhookBody(req, 4096, 'stripe');
    expect(result).toBe(body);
  });

  it('returns null when the declared content-length is over the cap', async () => {
    const body = 'x';
    const req = makeRequest(body, 999_999);
    const result = await readWebhookBody(req, 1024, 'stripe');
    expect(result).toBeNull();
  });

  it('returns the body when content-length is missing but actual size is OK', async () => {
    // Some providers omit content-length on chunked transfer; the helper
    // falls back to checking after the read.
    const body = 'small';
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      body,
    });
    const result = await readWebhookBody(req, 1024, 'stripe');
    expect(result).toBe(body);
  });

  it('returns null when actual UTF-8 byte length exceeds the cap (emoji edge case)', async () => {
    // A 4-byte UTF-8 character has `.length === 2` (one UTF-16
    // surrogate pair) but `byteLength === 4`. With a 4-byte cap a
    // single emoji should ALREADY exceed it; the helper must check
    // byteLength, not .length.
    const body = '😀😀😀'; // 4 bytes × 3 = 12 bytes; 6 UTF-16 code units
    const req = makeRequest(body); // no content-length
    const result = await readWebhookBody(req, 8, 'stripe');
    expect(result).toBeNull();
  });

  it('exposes per-provider caps in WEBHOOK_BODY_CAPS', () => {
    // Sanity check on the documented caps — guards against an
    // accidental shrink that breaks legitimate events.
    expect(WEBHOOK_BODY_CAPS.stripe).toBeGreaterThanOrEqual(16 * 1024);
    expect(WEBHOOK_BODY_CAPS.clerk).toBeGreaterThanOrEqual(64 * 1024);
    expect(WEBHOOK_BODY_CAPS.n_genius).toBeGreaterThanOrEqual(8 * 1024);
    expect(WEBHOOK_BODY_CAPS.ziina).toBeGreaterThanOrEqual(8 * 1024);
  });
});
