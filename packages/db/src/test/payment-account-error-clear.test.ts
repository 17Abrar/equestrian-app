import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import {
  clearPaymentAccountError,
  recordPaymentAccountError,
  disconnectPaymentAccount,
  upsertPaymentAccount,
} from '../queries';
import { clubs } from '../schema/clubs';
import { clubPaymentAccounts } from '../schema/finances';

/**
 * `clearPaymentAccountError` — the webhook-verified inverse of
 * `recordPaymentAccountError`. Webhook routes call it (via
 * `safeClearAccountError`) on the first delivery whose signature
 * verifies after a recorded misconfig, so the settings-panel error
 * badge self-heals instead of sticking until a full reconnect.
 *
 * These tests lock in the status-transition guard:
 *   - 'error'    → 'connected' (the only status transition it performs)
 *   - 'disabled' → completely untouched (deliberate disconnects must
 *                  never be resurrected by a late in-flight webhook)
 *   - 'pending'  → lastError cleared but status NOT promoted
 *   - healthy    → DB-level no-op (the conditional WHERE means not even
 *                  `updated_at` churns)
 *
 * …and the `seenUpdatedAt` compare-and-set (Codex security review,
 * 2026-06): a clear computed against a stale row snapshot must not erase
 * an error recorded AFTER that snapshot was read — the stale clear is a
 * no-op, and the next clear holding the current `updated_at` succeeds.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedClub(db: typeof testDb.db): Promise<string> {
  const [club] = await db
    .insert(clubs)
    .values({
      name: 'Clear Club',
      slug: 'clear-club',
      clerkOrgId: 'org_clear_club',
    })
    .returning({ id: clubs.id });
  if (!club) throw new Error('Failed to seed club');
  return club.id;
}

async function readAccount(db: typeof testDb.db, clubId: string) {
  const [row] = await db
    .select({
      status: clubPaymentAccounts.status,
      lastError: clubPaymentAccounts.lastError,
      updatedAt: clubPaymentAccounts.updatedAt,
    })
    .from(clubPaymentAccounts)
    .where(and(eq(clubPaymentAccounts.clubId, clubId), eq(clubPaymentAccounts.provider, 'stripe')));
  if (!row) throw new Error('Account row missing');
  return row;
}

describe('clearPaymentAccountError — status-transition guard', () => {
  it("transitions 'error' back to 'connected' and clears lastError", async () => {
    const clubId = await seedClub(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubId, {
        provider: 'stripe',
        status: 'connected',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        makeActive: true,
      });
      // The real lifecycle: a webhook misconfig records the error first.
      await recordPaymentAccountError(clubId, 'stripe', 'signature verification failed');
      const errored = await readAccount(testDb.db, clubId);
      expect(errored).toMatchObject({
        status: 'error',
        lastError: 'signature verification failed',
      });

      // `seenUpdatedAt` mirrors what the webhook routes pass: the
      // `updated_at` of the row they loaded for signature verification.
      // Here nothing raced between read and clear, so the CAS passes.
      await clearPaymentAccountError(clubId, 'stripe', errored.updatedAt);
    });

    expect(await readAccount(testDb.db, clubId)).toMatchObject({
      status: 'connected',
      lastError: null,
    });
  });

  it("never resurrects a 'disabled' account — status AND lastError untouched", async () => {
    const clubId = await seedClub(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubId, {
        provider: 'stripe',
        status: 'connected',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        makeActive: true,
      });
      await disconnectPaymentAccount(clubId, 'stripe');
    });

    // Force a lastError onto the disabled row directly — no live code
    // path writes one post-disconnect (config lookups filter disabled),
    // so this simulates the worst-case future caller the guard exists for.
    await testDb.db
      .update(clubPaymentAccounts)
      .set({ lastError: 'stale error from before disconnect' })
      .where(
        and(eq(clubPaymentAccounts.clubId, clubId), eq(clubPaymentAccounts.provider, 'stripe')),
      );

    // Read the live `updated_at` so the CAS predicate passes — this test
    // must prove the DISABLED guard blocks the clear, not the CAS.
    const seen = await readAccount(testDb.db, clubId);

    await withTestDb(testDb.db, async () => {
      await clearPaymentAccountError(clubId, 'stripe', seen.updatedAt);
    });

    // The WHERE excludes disabled rows entirely: a deliberate disconnect
    // is operator intent and a late verified webhook must not unwind it —
    // not even the lastError text changes.
    expect(await readAccount(testDb.db, clubId)).toMatchObject({
      status: 'disabled',
      lastError: 'stale error from before disconnect',
    });
  });

  it("clears lastError on a 'pending' account WITHOUT promoting it to 'connected'", async () => {
    const clubId = await seedClub(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubId, {
        provider: 'stripe',
        status: 'pending',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
      });
    });

    // Direct write: `recordPaymentAccountError` would flip status to
    // 'error', but we specifically need a non-error status carrying a
    // stale message to prove the CASE leaves it alone.
    await testDb.db
      .update(clubPaymentAccounts)
      .set({ lastError: 'stale message on a pending row' })
      .where(
        and(eq(clubPaymentAccounts.clubId, clubId), eq(clubPaymentAccounts.provider, 'stripe')),
      );

    // Live `updated_at` so the CAS passes and the CASE behaviour is what
    // this test actually exercises.
    const seen = await readAccount(testDb.db, clubId);

    await withTestDb(testDb.db, async () => {
      await clearPaymentAccountError(clubId, 'stripe', seen.updatedAt);
    });

    // Promotion to 'connected' belongs to the connect flow, not here.
    expect(await readAccount(testDb.db, clubId)).toMatchObject({
      status: 'pending',
      lastError: null,
    });
  });

  it('is a DB-level no-op on a healthy account (updated_at does not churn)', async () => {
    const clubId = await seedClub(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubId, {
        provider: 'stripe',
        status: 'connected',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        makeActive: true,
      });
    });

    const before = await readAccount(testDb.db, clubId);

    await withTestDb(testDb.db, async () => {
      await clearPaymentAccountError(clubId, 'stripe', before.updatedAt);
    });

    const after = await readAccount(testDb.db, clubId);
    // The conditional WHERE (`lastError IS NOT NULL OR status = 'error'`)
    // matched zero rows — identical `updated_at` proves the UPDATE never
    // touched the row, which is the route-side hot-path guarantee backed
    // up at the DB layer.
    expect(after.status).toBe('connected');
    expect(after.lastError).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('clearPaymentAccountError — seenUpdatedAt compare-and-set (Codex security review, 2026-06)', () => {
  it('a stale clear is a no-op when an error was recorded after the read; a fresh clear then succeeds', async () => {
    const clubId = await seedClub(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubId, {
        provider: 'stripe',
        status: 'connected',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        makeActive: true,
      });
      await recordPaymentAccountError(clubId, 'stripe', 'first error');
    });

    // The webhook route's "load": this snapshot is exactly what the route
    // would thread through safeClearAccountError after a signature passed.
    const seen = await readAccount(testDb.db, clubId);

    // THE RACE: a concurrent failing delivery records a NEWER error after
    // the route's read but before its clear lands. recordPaymentAccountError
    // stamps a fresh `updated_at`. The 5ms sleep guarantees the bump is
    // strictly newer than the snapshot at JS millisecond resolution — on a
    // fast machine both writes could otherwise land in the same ms and the
    // `updated_at <= seenUpdatedAt` predicate would alias.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await withTestDb(testDb.db, async () => {
      await recordPaymentAccountError(clubId, 'stripe', 'newer error recorded after the read');
    });

    await withTestDb(testDb.db, async () => {
      await clearPaymentAccountError(clubId, 'stripe', seen.updatedAt);
    });

    // The stale clear matched zero rows (live updated_at > seenUpdatedAt):
    // the newer error survives and the settings badge stays red. Without
    // the CAS this clear would have erased an error it never saw.
    expect(await readAccount(testDb.db, clubId)).toMatchObject({
      status: 'error',
      lastError: 'newer error recorded after the read',
    });

    // CONVERGENCE: the next verified fresh delivery reloads the row — its
    // snapshot now postdates the newer error — and its clear succeeds.
    // This is the argument for why a CAS-blocked clear is never "lost".
    const current = await readAccount(testDb.db, clubId);
    await withTestDb(testDb.db, async () => {
      await clearPaymentAccountError(clubId, 'stripe', current.updatedAt);
    });

    expect(await readAccount(testDb.db, clubId)).toMatchObject({
      status: 'connected',
      lastError: null,
    });
  });
});
