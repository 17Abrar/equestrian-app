import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb, withTestDb } from './harness';
import {
  upsertPaymentAccount,
  WebhookSecretReusedError,
  disconnectPaymentAccount,
} from '../queries';
import { clubs } from '../schema/clubs';
import { burnedWebhookSecretHashes } from '../schema/finances';

/**
 * Audit F-33 (2026-05-08 r6): two clubs cannot share the same webhook
 * signing secret. The route layer hashes the cleartext secret and
 * passes the SHA-256 digest to `upsertPaymentAccount`; the upsert
 * pre-checks for any other club's row carrying the same hash and
 * throws `WebhookSecretReusedError` so the connect route renders a
 * 409. The partial UNIQUE index in migration 0048 backstops the same
 * invariant at the DB layer for the read/write race window.
 *
 * These tests verify the application-layer pre-check; the index itself
 * is implicitly exercised because pglite applies migration 0048 in
 * `createTestDb`.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedTwoClubs(db: typeof testDb.db): Promise<{
  clubA: string;
  clubB: string;
}> {
  const [clubA] = await db
    .insert(clubs)
    .values({
      name: 'Alpha Club',
      slug: 'alpha-whs',
      clerkOrgId: 'org_alpha_whs',
    })
    .returning({ id: clubs.id });
  const [clubB] = await db
    .insert(clubs)
    .values({
      name: 'Bravo Club',
      slug: 'bravo-whs',
      clerkOrgId: 'org_bravo_whs',
    })
    .returning({ id: clubs.id });

  if (!clubA || !clubB) throw new Error('Failed to seed clubs');
  return { clubA: clubA.id, clubB: clubB.id };
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

describe('upsertPaymentAccount — webhook-secret-hash uniqueness (F-33)', () => {
  it('rejects when another club already bound the same hash', async () => {
    const { clubA, clubB } = await seedTwoClubs(testDb.db);
    const sharedHash = hash('whsec_shared_copypaste_secret');

    await withTestDb(testDb.db, async () => {
      // Club A connects first — succeeds.
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: sharedHash,
        makeActive: true,
      });

      // Club B tries to connect with the same `whsec_…` — must fail
      // with the dedicated error so the route returns 409.
      await expect(
        upsertPaymentAccount(clubB, {
          provider: 'stripe',
          status: 'connected',
          externalAccountId: 'acct_bravo',
          credentials: { secretKey: 'sk_test_b', publishableKey: 'pk_test_b' },
          metadata: {},
          webhookSecretHash: sharedHash,
          makeActive: true,
        }),
      ).rejects.toBeInstanceOf(WebhookSecretReusedError);
    });
  });

  it('allows the same club to re-upsert (rotate keys, change makeActive)', async () => {
    const { clubA } = await seedTwoClubs(testDb.db);
    const stableHash = hash('whsec_stable_secret');

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a1', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: stableHash,
        makeActive: true,
      });

      // Re-upsert (e.g., operator rotated the API key but kept the
      // webhook endpoint unchanged) must NOT trip the uniqueness check
      // because the existing row belongs to the SAME club.
      const second = await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a2', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: stableHash,
        makeActive: true,
      });

      expect(second.clubId).toBe(clubA);
      expect(second.status).toBe('connected');
    });
  });

  it('allows two clubs to connect when neither passes a webhook hash', async () => {
    const { clubA, clubB } = await seedTwoClubs(testDb.db);

    await withTestDb(testDb.db, async () => {
      // The webhook secret is optional at connect time. NULL hashes
      // never collide — the partial UNIQUE excludes nulls, and the
      // application pre-check skips when input is null.
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: null,
        makeActive: true,
      });

      const second = await upsertPaymentAccount(clubB, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_bravo',
        credentials: { secretKey: 'sk_test_b', publishableKey: 'pk_test_b' },
        metadata: {},
        webhookSecretHash: null,
        makeActive: true,
      });

      expect(second.clubId).toBe(clubB);
    });
  });

  it('allows two clubs to connect when each uses a distinct hash', async () => {
    const { clubA, clubB } = await seedTwoClubs(testDb.db);

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: hash('whsec_alpha_unique'),
        makeActive: true,
      });

      const second = await upsertPaymentAccount(clubB, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_bravo',
        credentials: { secretKey: 'sk_test_b', publishableKey: 'pk_test_b' },
        metadata: {},
        webhookSecretHash: hash('whsec_bravo_unique'),
        makeActive: true,
      });

      expect(second.clubId).toBe(clubB);
    });
  });
});

describe('upsertPaymentAccount — burned webhook hashes (D-1, audit pass-2)', () => {
  it('burns the previous hash when a club rotates to a new secret', async () => {
    const { clubA } = await seedTwoClubs(testDb.db);
    const oldHash = hash('whsec_old_secret');
    const newHash = hash('whsec_new_secret');

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        metadata: {},
        webhookSecretHash: oldHash,
        makeActive: true,
      });

      // Rotate: same club, new hash.
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        metadata: {},
        webhookSecretHash: newHash,
        makeActive: true,
      });
    });

    // The OLD hash must now be in burned_webhook_secret_hashes.
    const burnedRows = await testDb.db
      .select()
      .from(burnedWebhookSecretHashes)
      .where(eq(burnedWebhookSecretHashes.secretHash, oldHash));
    expect(burnedRows).toHaveLength(1);
    expect(burnedRows[0]?.provider).toBe('stripe');
    expect(burnedRows[0]?.clubId).toBe(clubA);
  });

  it('refuses a club to paste another club\'s previously-retired secret', async () => {
    const { clubA, clubB } = await seedTwoClubs(testDb.db);
    const sharedHash = hash('whsec_clubA_then_retired');

    await withTestDb(testDb.db, async () => {
      // Club A connects, then disconnects (which burns the hash).
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test_a', publishableKey: 'pk_test_a' },
        metadata: {},
        webhookSecretHash: sharedHash,
        makeActive: true,
      });
      await disconnectPaymentAccount(clubA, 'stripe');

      // Club B tries to paste the retired hash — must be rejected.
      // Without the burned-table check, the F-33 partial UNIQUE would
      // not catch this (clubA's row is now disabled / hash is null).
      await expect(
        upsertPaymentAccount(clubB, {
          provider: 'stripe',
          status: 'connected',
          externalAccountId: 'acct_bravo',
          credentials: { secretKey: 'sk_test_b', publishableKey: 'pk_test_b' },
          metadata: {},
          webhookSecretHash: sharedHash,
          makeActive: true,
        }),
      ).rejects.toBeInstanceOf(WebhookSecretReusedError);
    });
  });

  it('disconnect burns the hash and clears it from the live row', async () => {
    const { clubA } = await seedTwoClubs(testDb.db);
    const aHash = hash('whsec_to_be_burned_on_disconnect');

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        metadata: {},
        webhookSecretHash: aHash,
        makeActive: true,
      });

      const disconnected = await disconnectPaymentAccount(clubA, 'stripe');
      expect(disconnected?.status).toBe('disabled');
    });

    const burnedRows = await testDb.db
      .select()
      .from(burnedWebhookSecretHashes)
      .where(eq(burnedWebhookSecretHashes.secretHash, aHash));
    expect(burnedRows).toHaveLength(1);
    expect(burnedRows[0]?.clubId).toBe(clubA);
  });

  it('the same club can reconnect with a fresh hash after disconnect', async () => {
    const { clubA } = await seedTwoClubs(testDb.db);
    const oldHash = hash('whsec_a_old');
    const newHash = hash('whsec_a_new');

    await withTestDb(testDb.db, async () => {
      await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        metadata: {},
        webhookSecretHash: oldHash,
        makeActive: true,
      });
      await disconnectPaymentAccount(clubA, 'stripe');

      // Same club, fresh hash — must succeed.
      const reconnected = await upsertPaymentAccount(clubA, {
        provider: 'stripe',
        status: 'connected',
        externalAccountId: 'acct_alpha',
        credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
        metadata: {},
        webhookSecretHash: newHash,
        makeActive: true,
      });
      expect(reconnected.status).toBe('connected');
    });
  });
});
