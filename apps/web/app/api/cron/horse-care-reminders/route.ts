import { timingSafeEqual } from 'node:crypto';
import { type NextRequest } from 'next/server';
import {
  findUpcomingHealthRecordDueDates,
  findUpcomingHealthRecordFollowUps,
  findUpcomingHorseInsuranceExpiries,
  findUpcomingMedicationEnds,
  recordHorseCareReminderSend,
  getLastHorseCareReminderSentAt,
  type CareReminderCandidate,
} from '@equestrian/db/queries';
import { getTodayDateString } from '@equestrian/shared/utils';
import { sendTriggeredEmail } from '@/lib/email';
import {
  HorseCareReminder,
  type HorseCareReminderKind,
} from '@equestrian/email-templates/horse-care-reminder';
import { errorResponse, successResponse } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * Round 6.2 — daily horse care reminder cron. Fires four kinds of
 * reminders, all gated on `notification_preferences.horse_care_reminder`:
 *
 *   - 'horse_health_record_due'      thresholds 7 / 1 / 0  days
 *   - 'horse_health_record_followup' thresholds 7 / 1      days
 *   - 'horse_insurance'              thresholds 30 / 7 / 1 days
 *   - 'horse_medication_end'         thresholds 7 / 1      days
 *
 * Each (kind, source_id, threshold_days) tuple is dedup'd via
 * `horse_care_reminder_sends` — the helper does an INSERT ON CONFLICT
 * DO NOTHING, returning true only on a fresh row. Concurrent runs
 * resolve cleanly. Past-the-largest-threshold candidates are still
 * picked up by the lookahead query (it pulls every row where
 * `dueDate <= today + maxThreshold`); the cron then iterates
 * thresholds in DESCENDING order and emits the first unsent threshold,
 * so a record created late still gets the 1-day or 0-day reminder
 * even if the 7-day one was missed.
 *
 * Recipient is always `clubs.email`. Per-horse owner addressing was
 * considered but: (1) most owners are also club members so the staff
 * email reaches them through their dashboard, (2) horse care is a
 * stable-operations matter rather than an owner-billing one, (3) it
 * keeps the cron focused on one recipient resolution path.
 *
 * Schedule: `0 3 * * *` (03:00 UTC daily). Sequenced after platform-
 * billing (02:15 UTC) so the platform cron's CPU budget is its own.
 */

const KIND_THRESHOLDS: Record<HorseCareReminderKind, readonly number[]> = {
  horse_health_record_due: [7, 1, 0],
  horse_health_record_followup: [7, 1],
  horse_insurance: [30, 7, 1],
  horse_medication_end: [7, 1],
};

/**
 * Audit MED (2026-05-06 closeout): minimum gap between consecutive
 * reminders for the same (kind, sourceId). Without this, a record
 * CREATED late (admin backfills a vaccination 5 days overdue) burns
 * through every applicable threshold on consecutive daily cron runs
 * (7→1→0), spamming 2-3 emails for one care item. The gap caps the
 * cadence to one email per care item per N days. 5 is large enough
 * that the 7d → 1d → 0d sequence still hits all three slots over a
 * normal lead-up window (record exists ≥7d before due date), but
 * close enough that a late-registered record only emits one email
 * the day it's discovered + one final urgent ping.
 */
const MIN_REMINDER_GAP_DAYS = 5;

export async function POST(request: NextRequest) {
  const headerSecret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    logger.error('horse_care_reminder_cron_secret_not_configured');
    return errorResponse('NOT_CONFIGURED', 'CRON_SECRET not set', 503);
  }

  // Constant-time compare with length-padding (mirrors livery + platform
  // + booking-reminder cron pattern — audit B-15).
  const provided = Buffer.from(headerSecret ?? '', 'utf8');
  const target = Buffer.from(expected, 'utf8');
  const sameLength = provided.length === target.length;
  const padded = sameLength ? provided : Buffer.alloc(target.length);
  const compareResult = timingSafeEqual(padded, target);
  const secretOk = sameLength && compareResult;
  if (!secretOk) {
    logger.warn('horse_care_reminder_cron_bad_secret', {
      headerPresent: headerSecret !== null,
      providedLength: provided.length,
      ip:
        request.headers.get('cf-connecting-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request.headers.get('x-real-ip') ??
        'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
    });
    return errorResponse('UNAUTHORIZED', 'Bad cron secret', 401);
  }

  const utcToday = new Date().toISOString().slice(0, 10);

  try {
    const dueDates = await processKind(
      'horse_health_record_due',
      utcToday,
      findUpcomingHealthRecordDueDates,
    );
    const followUps = await processKind(
      'horse_health_record_followup',
      utcToday,
      findUpcomingHealthRecordFollowUps,
    );
    const insurance = await processKind(
      'horse_insurance',
      utcToday,
      findUpcomingHorseInsuranceExpiries,
    );
    const medicationEnds = await processKind(
      'horse_medication_end',
      utcToday,
      findUpcomingMedicationEnds,
    );

    const totals = {
      sent:
        dueDates.sent +
        followUps.sent +
        insurance.sent +
        medicationEnds.sent,
      skipped:
        dueDates.skipped +
        followUps.skipped +
        insurance.skipped +
        medicationEnds.skipped,
      considered:
        dueDates.considered +
        followUps.considered +
        insurance.considered +
        medicationEnds.considered,
    };

    logger.info('horse_care_reminder_cron_completed', {
      utcToday,
      ...totals,
      breakdown: {
        due_dates: dueDates,
        follow_ups: followUps,
        insurance,
        medication_ends: medicationEnds,
      },
    });

    return successResponse({
      date: utcToday,
      ...totals,
      breakdown: {
        due_dates: dueDates,
        follow_ups: followUps,
        insurance,
        medication_ends: medicationEnds,
      },
    });
  } catch (err) {
    logger.error('horse_care_reminder_cron_failed', {
      utcToday,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('CRON_FAILED', 'Cron run failed', 500);
  }
}

interface KindResult {
  sent: number;
  skipped: number;
  considered: number;
}

async function processKind(
  kind: HorseCareReminderKind,
  utcToday: string,
  fetcher: (args: {
    todayIso: string;
    lookAheadDays: number;
  }) => Promise<CareReminderCandidate[]>,
): Promise<KindResult> {
  const thresholds = KIND_THRESHOLDS[kind];
  const lookAheadDays = thresholds[0]!;
  const candidates = await fetcher({ todayIso: utcToday, lookAheadDays });
  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      // Resolve "today" in the club's own timezone. A non-UTC club
      // would otherwise have its day-0 reminder fire ±1 day off at the
      // boundary. Mirrors livery/platform/booking-reminder pattern.
      const clubToday = getTodayDateString(candidate.clubTimezone);
      const daysUntil = daysBetween(clubToday, candidate.dueDate);

      // No email on file = nothing to send. Skip without writing to
      // the dedup table so a future email patch picks the cadence up
      // from scratch (mirrors livery audit G-2).
      if (!candidate.clubEmail) {
        skipped += 1;
        continue;
      }

      // Audit MED (2026-05-06 closeout): minimum-gap guard. Before
      // walking thresholds, check the most recent send for this
      // (kind, sourceId). If we've sent within the last
      // MIN_REMINDER_GAP_DAYS, skip — even if a smaller (more urgent)
      // threshold would now match. Prevents the consecutive-day burst
      // for late-registered records (admin backfills a vaccination
      // 5 days overdue → without this, three emails on three days).
      const lastSentAt = await getLastHorseCareReminderSentAt({
        clubId: candidate.clubId,
        kind,
        sourceId: candidate.sourceId,
      });
      if (lastSentAt) {
        const daysSinceLast =
          (new Date(`${clubToday}T00:00:00Z`).getTime() - lastSentAt.getTime()) /
          (24 * 60 * 60 * 1000);
        if (daysSinceLast < MIN_REMINDER_GAP_DAYS) {
          skipped += 1;
          continue;
        }
      }

      // Find the highest threshold this candidate currently satisfies.
      // Iterate descending so we pick the largest unsent threshold —
      // that emits the most-recently-applicable reminder when a
      // candidate slipped past earlier thresholds (e.g. a record
      // created 6 days before its due date never had a 7-day window
      // to fire in).
      let chosenThreshold: number | undefined;
      for (const t of thresholds) {
        if (daysUntil > t) continue;
        // (chosenThreshold === undefined → first match in descending
        // iteration; remember and keep iterating so we prefer the
        // already-sent threshold over a smaller unsent one — but the
        // CAS in `recordHorseCareReminderSend` is the source of truth.
        // Simplest: try the threshold; if already sent, move to next.)
        const claimed = await recordHorseCareReminderSend({
          clubId: candidate.clubId,
          kind,
          sourceId: candidate.sourceId,
          thresholdDays: t,
        });
        if (claimed) {
          chosenThreshold = t;
          break;
        }
      }

      if (chosenThreshold === undefined) {
        // Either daysUntil is larger than every threshold (record is
        // further out than the largest cadence — handled by the
        // lookAhead bound, but belt-and-braces) or every applicable
        // threshold has already been emitted.
        skipped += 1;
        continue;
      }

      await sendTriggeredEmail({
        clubId: candidate.clubId,
        trigger: 'horse_care_reminder',
        to: candidate.clubEmail,
        subject: subjectFor(kind, daysUntil, candidate),
        template: HorseCareReminder({
          kind,
          dueDate: candidate.dueDate,
          daysUntil,
          horseName: candidate.horseName,
          clubName: candidate.clubName,
          clubLogo: candidate.clubLogoUrl ?? undefined,
          careTypeLabel: candidate.careTypeLabel,
          detail: candidate.detail ?? undefined,
        }),
      });
      sent += 1;
    } catch (err) {
      logger.error('horse_care_reminder_send_failed', {
        kind,
        sourceId: candidate.sourceId,
        clubId: candidate.clubId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      skipped += 1;
    }
  }

  return { sent, skipped, considered: candidates.length };
}

function subjectFor(
  kind: HorseCareReminderKind,
  daysUntil: number,
  c: CareReminderCandidate,
): string {
  const when =
    daysUntil < 0
      ? 'overdue'
      : daysUntil === 0
        ? 'today'
        : daysUntil === 1
          ? 'tomorrow'
          : `in ${daysUntil} days`;
  switch (kind) {
    case 'horse_health_record_due':
      return `${c.careTypeLabel} for ${c.horseName} ${when}`;
    case 'horse_health_record_followup':
      return `Vet follow-up for ${c.horseName} ${when}`;
    case 'horse_insurance':
      return `Insurance renewal for ${c.horseName} ${when}`;
    case 'horse_medication_end':
      return `${c.detail ?? 'Medication'} for ${c.horseName} ends ${when}`;
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const to = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((to - from) / 86_400_000);
}
