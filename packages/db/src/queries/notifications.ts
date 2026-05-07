import { db as defaultDb } from '../index';
import {
  notifications,
  type NotificationData,
  NOTIFICATION_FORBIDDEN_FIELDS,
} from '../schema/operations';

/**
 * Audit F-61 (2026-05-07 r5). Thin write helper that enforces the
 * `NOTIFICATION_FORBIDDEN_FIELDS` invariant promised in the schema
 * comment block at `packages/db/src/schema/operations.ts:39-65`.
 *
 * The `notifications` table holds plaintext, indefinite-retention rows
 * — the encrypted-at-rest invariant we maintain on
 * `horse_health_records.diagnosis` / `rider_profiles.medicalNotes` /
 * etc. would be broken the moment a future feature copies a freshly-
 * decrypted PHI value into `notifications.body` or `notifications.data`.
 * No caller exists today (notifications writes are gated until the
 * Round 7 in-app notifications feature lands), but the schema-level
 * promise was never operationalised — so the next contributor reaching
 * for `db.insert(notifications)` will likely skip the runtime check.
 *
 * This helper is the safe entry point. Use it instead of a raw insert.
 *
 * Throws on a forbidden-field violation rather than silently dropping
 * the key — a swallowed PHI leak is worse than a 500 the operator can
 * see in Sentry.
 */

export interface CreateNotificationArgs {
  /** Tenant scope. May be null only for system-level notifications
   *  (no caller today). */
  clubId: string | null;
  recipientMemberId: string;
  /** Discriminator that consumers narrow `data` against. */
  type: string;
  title: string;
  body: string;
  data?: NotificationData | null;
}

export class NotificationForbiddenFieldError extends Error {
  constructor(field: string, location: 'data' | 'body' | 'title') {
    super(
      `createNotification refused: ${location} carries forbidden PHI key "${field}". See NOTIFICATION_FORBIDDEN_FIELDS in operations.ts. Reference the source row by id instead and decrypt at render time.`,
    );
    this.name = 'NotificationForbiddenFieldError';
  }
}

function assertNoForbiddenFields(args: CreateNotificationArgs): void {
  if (args.data && typeof args.data === 'object') {
    for (const key of Object.keys(args.data)) {
      if ((NOTIFICATION_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
        throw new NotificationForbiddenFieldError(key, 'data');
      }
    }
  }
  // The body/title scan is intentionally a substring check on the
  // forbidden FIELD names — not a content scan. The promise the schema
  // comment makes is "no PHI key surfaces in body/data" — interpolating
  // a record's diagnosis text wholesale would defeat that promise. A
  // case-insensitive substring guard catches the obvious forms
  // ("Diagnosis: …", "Medical notes for Bella …") without trying to
  // be a generic PHI classifier.
  const lowerBody = args.body.toLowerCase();
  const lowerTitle = args.title.toLowerCase();
  for (const key of NOTIFICATION_FORBIDDEN_FIELDS) {
    if (lowerBody.includes(key.toLowerCase())) {
      throw new NotificationForbiddenFieldError(key, 'body');
    }
    if (lowerTitle.includes(key.toLowerCase())) {
      throw new NotificationForbiddenFieldError(key, 'title');
    }
  }
}

export async function createNotification(
  args: CreateNotificationArgs,
  db: typeof defaultDb = defaultDb,
) {
  assertNoForbiddenFields(args);

  const result = await db
    .insert(notifications)
    .values({
      clubId: args.clubId,
      recipientMemberId: args.recipientMemberId,
      type: args.type,
      title: args.title,
      body: args.body,
      data: args.data ?? null,
    })
    .returning();
  return result[0] ?? null;
}
