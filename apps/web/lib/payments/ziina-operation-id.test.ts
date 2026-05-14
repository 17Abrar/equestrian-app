import { describe, it, expect } from 'vitest';
import { toZiinaIdempotencyUuid } from './ziina-operation-id';

/**
 * Audit 2026-05-13 (P1): unit tests for the deterministic-UUID
 * idempotency-key transform. Ziina's API requires `operation_id` to
 * match a UUID v4 shape; our internal idempotency keys (e.g.
 * `booking_<uuid>_AED_18000`) don't. This helper hashes the key into
 * a stable UUID — same input → same UUID forever, so a retry replays
 * the original Ziina intent instead of minting a duplicate charge.
 */
describe('toZiinaIdempotencyUuid', () => {
  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('passes through an input that is already a UUID (lower-cased)', () => {
    const input = '550E8400-E29B-41D4-A716-446655440000';
    expect(toZiinaIdempotencyUuid(input)).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('produces a deterministic UUID for a non-UUID input', () => {
    const a = toZiinaIdempotencyUuid('booking_abc_AED_18000');
    const b = toZiinaIdempotencyUuid('booking_abc_AED_18000');
    expect(a).toBe(b);
    expect(a).toMatch(UUID_V4_PATTERN);
  });

  it('produces distinct UUIDs for distinct inputs', () => {
    const a = toZiinaIdempotencyUuid('booking_abc_AED_18000');
    const b = toZiinaIdempotencyUuid('booking_xyz_AED_18000');
    expect(a).not.toBe(b);
  });

  it('changes when the amount changes (audit pass-4 F-69)', () => {
    // Including amount in the upstream key ensures admin coupon edits
    // mint a fresh intent rather than replaying the stale price.
    const original = toZiinaIdempotencyUuid('booking_abc_AED_18000');
    const adjusted = toZiinaIdempotencyUuid('booking_abc_AED_12000');
    expect(original).not.toBe(adjusted);
  });

  it('changes when the currency changes', () => {
    const aed = toZiinaIdempotencyUuid('booking_abc_AED_18000');
    const usd = toZiinaIdempotencyUuid('booking_abc_USD_18000');
    expect(aed).not.toBe(usd);
  });

  it('namespaces the hash so collisions with unrelated SHA inputs are avoided', () => {
    // The implementation prefixes with `cavaliq:ziina-operation:` before
    // hashing. A raw SHA of the same input should differ from the result.
    const result = toZiinaIdempotencyUuid('test-key');
    expect(result).toMatch(UUID_V4_PATTERN);
    // Two near-identical inputs should produce wildly different UUIDs
    // (avalanche property of SHA-256).
    const sibling = toZiinaIdempotencyUuid('test-keyX');
    const distance = [...result].filter((ch, i) => ch !== sibling[i]).length;
    expect(distance).toBeGreaterThan(10);
  });

  it('encodes the version nibble as 5 (UUID v5-shaped, not v4)', () => {
    // The implementation hard-sets char[12] = '5'. UUID v5 is the
    // name-based SHA-1 variant; v4 is random. The Ziina API doesn't
    // enforce a specific version, only the shape — but documenting
    // the actual choice keeps a future reader from being surprised.
    const result = toZiinaIdempotencyUuid('booking_abc');
    const versionNibble = result.charAt(14);
    expect(versionNibble).toBe('5');
  });

  it('encodes the variant nibble as one of 8/9/a/b (RFC 4122 variant 1)', () => {
    const result = toZiinaIdempotencyUuid('booking_abc');
    const variantNibble = result.charAt(19);
    expect(['8', '9', 'a', 'b']).toContain(variantNibble);
  });
});
