import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Hr,
  Section,
  Img,
} from '@react-email/components';

/**
 * Round 6.2 — horse care reminder. One template, four `kind`s. Single
 * source of truth for copy so vaccination / farrier / dental / vet
 * follow-up / insurance / medication-end reminders all look like a
 * cohesive operations email rather than 4-6 templates that drift
 * apart over time.
 *
 * Tone: terse, scannable, treats the recipient as the stable's
 * operations team (clubs.email goes to whoever runs the calendar).
 * Subject and headline adapt to `kind` and `daysUntil`.
 */
export type HorseCareReminderKind =
  | 'horse_health_record_due'
  | 'horse_health_record_followup'
  | 'horse_insurance'
  | 'horse_medication_end';

interface HorseCareReminderProps {
  kind: HorseCareReminderKind;
  /** When the underlying record is due — e.g. vaccination next-due date,
   *  follow-up date, insurance expiry date, or medication end date. */
  dueDate: string;
  /** Negative = overdue, 0 = today, positive = days remaining. */
  daysUntil: number;
  horseName: string;
  clubName: string;
  clubLogo?: string;
  /** Care type label — e.g. "Vaccination", "Farrier", "Dental",
   *  "Vet follow-up", "Insurance renewal", "Medication end".
   *  Pre-rendered by the cron from the source row's `record_type` /
   *  medication name / insurance flag. Always present. */
  careTypeLabel: string;
  /** Free-form detail row (e.g. medication name + dosage, vet name,
   *  insurance provider). Optional — the email reads fine without. */
  detail?: string;
}

const TITLES: Record<HorseCareReminderKind, string> = {
  horse_health_record_due: 'Horse care due',
  horse_health_record_followup: 'Vet follow-up scheduled',
  horse_insurance: 'Horse insurance expiring',
  horse_medication_end: 'Medication ending',
};

const DASHBOARD_PATHS: Record<HorseCareReminderKind, string> = {
  horse_health_record_due: '/horses',
  horse_health_record_followup: '/horses',
  horse_insurance: '/horses',
  horse_medication_end: '/horses',
};

export function HorseCareReminder({
  kind,
  dueDate,
  daysUntil,
  horseName,
  clubName,
  clubLogo,
  careTypeLabel,
  detail,
}: HorseCareReminderProps) {
  const headline = headlineFor(kind, daysUntil, horseName);
  const status =
    daysUntil < 0
      ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} overdue`
      : daysUntil === 0
        ? 'Today'
        : `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          {clubLogo && <Img src={clubLogo} alt={clubName} width={120} style={styles.logo} />}

          <Heading style={styles.heading}>{TITLES[kind]}</Heading>

          <Text style={styles.text}>{headline}</Text>

          <Section style={styles.detailsBox}>
            <Text style={styles.detailRow}>
              <strong>Horse:</strong> {horseName}
            </Text>
            <Text style={styles.detailRow}>
              <strong>Type:</strong> {careTypeLabel}
            </Text>
            <Text style={styles.detailRow}>
              <strong>Due:</strong> {dueDate}
            </Text>
            <Text style={styles.detailRow}>
              <strong>Status:</strong> {status}
            </Text>
            {detail && (
              <Text style={styles.detailRow}>
                <strong>Detail:</strong> {detail}
              </Text>
            )}
          </Section>

          <Text style={styles.text}>
            Open the horse&apos;s profile in the dashboard to log the visit, update the next-due
            date, or attach receipts.
          </Text>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>
            You&apos;re receiving this because horse care reminders are on for {clubName}. Toggle
            them off in Settings → Notifications if your team uses an external calendar.
          </Text>

          <Text style={styles.clubName}>{clubName}</Text>
          <Text style={styles.dashboardPath}>cavaliq.com{DASHBOARD_PATHS[kind]}</Text>
        </Container>
      </Body>
    </Html>
  );
}

function headlineFor(kind: HorseCareReminderKind, daysUntil: number, horseName: string): string {
  const when =
    daysUntil < 0
      ? 'is past due'
      : daysUntil === 0
        ? 'is due today'
        : daysUntil === 1
          ? 'is due tomorrow'
          : `is due in ${daysUntil} days`;
  switch (kind) {
    case 'horse_health_record_due':
      return `Routine care for ${horseName} ${when}.`;
    case 'horse_health_record_followup':
      return `A vet follow-up for ${horseName} ${when}.`;
    case 'horse_insurance':
      return `${horseName}&rsquo;s insurance policy ${when.replace('due', 'expiring')}.`;
    case 'horse_medication_end':
      return `An active medication for ${horseName} ends ${when.replace('is due', 'on')}.`;
  }
}

const styles = {
  body: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f9fafb',
    margin: '0',
    padding: '0',
  },
  container: { maxWidth: '600px', margin: '0 auto', padding: '40px 20px' },
  logo: { marginBottom: '24px' },
  heading: { fontSize: '22px', fontWeight: '700' as const, color: '#111827', marginBottom: '8px' },
  text: { fontSize: '14px', color: '#374151', marginBottom: '16px', lineHeight: '22px' },
  detailsBox: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px',
  },
  detailRow: { fontSize: '14px', color: '#374151', margin: '4px 0' },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
  clubName: { fontSize: '12px', color: '#9ca3af', fontWeight: '600' as const, marginTop: '16px' },
  dashboardPath: {
    fontSize: '11px',
    color: '#9ca3af',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
};
