import { type NextRequest } from 'next/server';
import {
  findUpcomingHealthRecordDueDates,
  findUpcomingHealthRecordFollowUps,
  findUpcomingHorseInsuranceExpiries,
  findUpcomingMedicationEnds,
  recordHorseCareReminderSend,
  unrecordHorseCareReminderSend,
  type CareReminderCandidate,
} from '@equestrian/db/queries';
import { getTodayDateString } from '@equestrian/shared/utils';
import { MS_PER_DAY } from '@equestrian/shared/constants';
import { sendTriggeredEmail } from '@/lib/email';
import {
  HorseCareReminder,
  type HorseCareReminderKind,
} from '@equestrian/email-templates/horse-care-reminder';
import { errorResponse, successResponse, requireCronSecret } from '@/lib/api-utils';
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

export async function POST(request: NextRequest) {
  // Audit F-21 (2026-05-06): centralized cron-secret guard.
  const unauthorized = await requireCronSecret(request, 'horse_care_reminder_cron');
  if (unauthorized) return unauthorized;

  // Audit F-15 (2026-05-06): see livery cron for rationale.
  logger.info('horse_care_reminder_cron_started');

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

      // Audit MED (2026-05-06 closeout, REVISED): cadence-window logic
      // — only fire a threshold when daysUntil falls within its
      // *natural* window, defined as the half-open range
      // (nextSmallerThreshold, threshold]. For [7, 1, 0]:
      //   t=7  fires when daysUntil ∈ (1, 7]  (i.e. 2..7)
      //   t=1  fires when daysUntil ∈ (0, 1]  (i.e. exactly 1)
      //   t=0  fires when daysUntil ∈ (-∞, 0] (today or overdue)
      //
      // Why this shape closes the audit gap correctly: a normal-flow
      // record (created ≥7d before due) hits each window exactly once
      // and emits 3 emails over the natural cadence (-7d, -1d, day-of).
      // A late-registered record (admin backfills 5d overdue,
      // daysUntil=-5) only hits the t=0 window — ONE email, no burst.
      //
      // The previous shape (descending iteration, claim largest unsent)
      // double-emitted across consecutive days for late records: day-0
      // fired t=7, day-1 fired t=1, day-2 fired t=0. This shape is
      // self-limiting because the windows don't overlap.
      //
      // Iterate from largest threshold to smallest so the natural
      // order is preserved if multiple windows technically fit (e.g.
      // a hypothetical thresholds=[7, 7] — currently impossible but
      // future-proof). Each threshold only matches its narrow window.
      let chosenThreshold: number | undefined;
      for (let i = 0; i < thresholds.length; i++) {
        const t = thresholds[i]!;
        const nextSmaller =
          i + 1 < thresholds.length ? thresholds[i + 1]! : Number.NEGATIVE_INFINITY;
        const inWindow = daysUntil <= t && daysUntil > nextSmaller;
        if (!inWindow) continue;

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

      try {
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
      } catch (sendErr) {
        // Audit pass-2 (2026-05-09 C-2): the dedup row was claimed
        // before the send. A transient Resend failure (rate limit,
        // 5xx) would otherwise permanently silence this reminder
        // because the dedup row blocks every future cron pass. Roll
        // back the dedup so the next pass can retry. Mirrors
        // `unmarkBookingReminderSent` in the booking-reminders cron
        // (audit F-61). The outer catch below still logs the failure.
        await unrecordHorseCareReminderSend({
          clubId: candidate.clubId,
          kind,
          sourceId: candidate.sourceId,
          thresholdDays: chosenThreshold,
        });
        throw sendErr;
      }
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
  return Math.round((to - from) / MS_PER_DAY);
}
