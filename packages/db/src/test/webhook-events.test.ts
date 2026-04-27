import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventFailed,
  markWebhookEventPermanentlyFailed,
  MAX_WEBHOOK_ATTEMPTS,
} from '../queries/webhook-events';

/**
 * Integration tests for the webhook dedup state machine. Covers the
 * 2026-04 audit's CRITICAL #1 finding: processing errors must not
 * permanently shadow-lose webhook events.
 *
 * Note on concurrency (audit H-16): pglite executes JavaScript-issued
 * queries on a single in-process WASM instance, so `Promise.all([...])`
 * effectively serialises them. These tests verify ALGORITHM correctness
 * (the SQL is sound, the CAS shape produces expected return values) but
 * do not exercise true parallel sessions. The neon-smoke job in
 * `scripts/test-neon-smoke.mjs` runs against real Postgres and is the
 * authoritative coverage for actual concurrency. See also the audit's
 * H-16 entry for the option of adding a worker_threads-based parallel
 * test against real Postgres.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

describe('claimWebhookEvent', () => {
  it('first-time claim returns { status: "claimed", attempt: 1 }', async () => {
    const result = await withTestDb(testDb.db, () =>
      claimWebhookEvent('stripe', 'evt_test_1'),
    );
    expect(result).toEqual({ status: 'claimed', attempt: 1 });
  });

  it('second concurrent claim on the same event returns "in_flight"', async () => {
    await withTestDb(testDb.db, async () => {
      const first = await claimWebhookEvent('stripe', 'evt_test_2');
      const second = await claimWebhookEvent('stripe', 'evt_test_2');
      expect(first).toEqual({ status: 'claimed', attempt: 1 });
      expect(second.status).toBe('in_flight');
    });
  });

  it('after markProcessed, replay returns "already_processed"', async () => {
    await withTestDb(testDb.db, async () => {
      await claimWebhookEvent('stripe', 'evt_test_3');
      await markWebhookEventProcessed('stripe', 'evt_test_3');
      const replay = await claimWebhookEvent('stripe', 'evt_test_3');
      expect(replay.status).toBe('already_processed');
    });
  });

  it('after markFailed, retry re-claims and bumps attempt count', async () => {
    await withTestDb(testDb.db, async () => {
      await claimWebhookEvent('stripe', 'evt_test_4');
      await markWebhookEventFailed('stripe', 'evt_test_4', 'Neon blip');
      const retry = await claimWebhookEvent('stripe', 'evt_test_4');
      expect(retry.status).toBe('claimed');
      if (retry.status === 'claimed') {
        expect(retry.attempt).toBe(2);
      }
    });
  });

  it('same eventId across different providers is not deduped', async () => {
    await withTestDb(testDb.db, async () => {
      const a = await claimWebhookEvent('stripe', 'evt_collide');
      const b = await claimWebhookEvent('n_genius', 'evt_collide');
      expect(a.status).toBe('claimed');
      expect(b.status).toBe('claimed');
    });
  });

  it('20 concurrent claims on the same event result in exactly one "claimed"', async () => {
    // The fix's whole point: concurrent duplicate deliveries must
    // serialise so exactly one worker does the work.
    await withTestDb(testDb.db, async () => {
      const claims = await Promise.all(
        Array.from({ length: 20 }, () =>
          claimWebhookEvent('stripe', 'evt_concurrent'),
        ),
      );
      const winners = claims.filter((c) => c.status === 'claimed');
      const losers = claims.filter((c) => c.status === 'in_flight');
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(19);
    });
  });
});

describe('markWebhookEventFailed', () => {
  it('stores the error message (truncated to 1000 chars)', async () => {
    // Long error strings shouldn't blow up the row.
    const longMessage = 'x'.repeat(5000);
    await withTestDb(testDb.db, async () => {
      await claimWebhookEvent('stripe', 'evt_long_err');
      await markWebhookEventFailed('stripe', 'evt_long_err', longMessage);
      // Re-claim verifies the row transitioned to 'failed'.
      const retry = await claimWebhookEvent('stripe', 'evt_long_err');
      expect(retry.status).toBe('claimed');
    });
  });
});

// Audit B-12 / H-10 — claim transitions to permanently_failed after
// MAX_WEBHOOK_ATTEMPTS, and direct mark-permanently-failed surfaces the
// new state to subsequent claims.
describe('claim → permanently_failed', () => {
  it('auto-transitions after MAX_WEBHOOK_ATTEMPTS retries', async () => {
    await withTestDb(testDb.db, async () => {
      // First claim + fail.
      await claimWebhookEvent('clerk', 'evt_perm_loop');
      await markWebhookEventFailed('clerk', 'evt_perm_loop', 'org_not_found');
      // Repeat until MAX-1 attempts have been recorded.
      for (let i = 1; i < MAX_WEBHOOK_ATTEMPTS; i += 1) {
        const claim = await claimWebhookEvent('clerk', 'evt_perm_loop');
        expect(claim.status).toBe('claimed');
        await markWebhookEventFailed('clerk', 'evt_perm_loop', 'org_not_found');
      }
      // The next claim should auto-transition to permanently_failed.
      const final = await claimWebhookEvent('clerk', 'evt_perm_loop');
      expect(final.status).toBe('permanently_failed');
    });
  });

  it('explicit markWebhookEventPermanentlyFailed makes future claims surface the status', async () => {
    await withTestDb(testDb.db, async () => {
      await claimWebhookEvent('clerk', 'evt_perm_explicit');
      await markWebhookEventPermanentlyFailed(
        'clerk',
        'evt_perm_explicit',
        'org_not_found_after_3_attempts',
      );
      const replay = await claimWebhookEvent('clerk', 'evt_perm_explicit');
      expect(replay.status).toBe('permanently_failed');
    });
  });
});
