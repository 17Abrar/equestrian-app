import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, withTestDb } from './harness';
import { createLiveryInvoice } from '../queries/livery-invoices';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';

/**
 * Audit F-4 (2026-05-07 r5) regression. The unique constraint on
 * `(horse_id, period_start)` is the partial index
 * `livery_invoices_unique_horse_period_active` (migration 0027) with a
 * `WHERE status <> 'cancelled'` predicate. Pre-fix, the
 * `onConflictDoNothing` call site in `createLiveryInvoice` did not
 * specify the matching predicate, which meant any duplicate insert for
 * an active period raised SQLSTATE 42P10 instead of returning null.
 * Post-fix, two `createLiveryInvoice` calls back-to-back for the same
 * (horse, period) succeed quietly — the second returns null.
 */
let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

let seedCounter = 0;

async function seedClubMemberAndHorse(
  db: typeof testDb.db,
): Promise<{ clubId: string; ownerMemberId: string; horseId: string }> {
  const n = ++seedCounter;
  const [club] = await db
    .insert(clubs)
    .values({
      name: `Test Club ${n}`,
      slug: `livery-conflict-${n}`,
      clerkOrgId: `org_livery_conflict_${n}`,
    })
    .returning({ id: clubs.id });
  const [member] = await db
    .insert(clubMembers)
    .values({
      clubId: club!.id,
      clerkUserId: `user_livery_conflict_${n}`,
      email: `owner${n}@example.com`,
      role: 'horse_owner',
    })
    .returning({ id: clubMembers.id });
  const [horse] = await db
    .insert(horses)
    .values({
      clubId: club!.id,
      name: `Stardust ${n}`,
      ownerMemberId: member!.id,
      ownershipStatus: 'active',
      monthlyLiveryFeeMinor: 150_000,
      liveryStartDate: '2026-05-01',
    })
    .returning({ id: horses.id });
  return {
    clubId: club!.id,
    ownerMemberId: member!.id,
    horseId: horse!.id,
  };
}

describe('createLiveryInvoice — partial-index ON CONFLICT', () => {
  it('second call for the same (horse, period) returns null instead of throwing', async () => {
    const { clubId, ownerMemberId, horseId } = await seedClubMemberAndHorse(testDb.db);

    await withTestDb(testDb.db, async () => {
      const first = await createLiveryInvoice({
        clubId,
        horseId,
        ownerMemberId,
        invoiceNumber: 'LIV-test-00001',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        amountMinorUnits: 150_000,
        currency: 'AED',
        dueDate: '2026-05-08',
      });
      expect(first).not.toBeNull();
      expect(first?.invoiceNumber).toBe('LIV-test-00001');

      // Pre-fix this would have raised SQLSTATE 42P10 because the
      // partial-index predicate wasn't specified on the ON CONFLICT.
      // Post-fix it's a quiet no-op (the cron's idempotency contract).
      const second = await createLiveryInvoice({
        clubId,
        horseId,
        ownerMemberId,
        invoiceNumber: 'LIV-test-00002',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        amountMinorUnits: 150_000,
        currency: 'AED',
        dueDate: '2026-05-08',
      });
      expect(second).toBeNull();
    });
  });
});
