import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Hr,
  Button,
  Section,
} from '@react-email/components';
import { formatCurrency } from '@equestrian/shared/utils';
import { safeHref } from './util/safe-href';

/**
 * Round 6.1 — Cavaliq → club admin trial-ending nudge. Fires from the
 * platform-billing cron when `clubs.trial_ends_at` is 3 days or 1 day
 * away. The first paid invoice will be issued the day the trial ends
 * (the cron's existing issuance logic anchors on `trial_ends_at`); this
 * email gives the admin a heads-up so they can pick a tier and have the
 * pay link ready to click.
 *
 * `daysUntilEnd` is 1 or 3; the copy adjusts. Lower numbers (today /
 * past-end) are NOT handled here — the trial-end day is when the actual
 * subscription-invoice-issued email fires with the pay link.
 */
interface TrialEndingProps {
  recipientName: string;
  clubName: string;
  daysUntilEnd: 1 | 3;
  trialEndDate: string;
  /** The tier the club selected (or `null` if they haven't picked one
   *  yet — in that case we steer them to Settings → Subscription to
   *  choose). Snapshot at email time. */
  selectedTier: 'starter' | 'growing' | 'professional' | null;
  /** Tier price in minor units. Null when `selectedTier` is null. */
  tierPriceMinor: number | null;
  currency: string;
  settingsUrl: string;
}

const TIER_LABELS: Record<NonNullable<TrialEndingProps['selectedTier']>, string> = {
  starter: 'Starter',
  growing: 'Growing',
  professional: 'Professional',
};

export function TrialEnding({
  recipientName,
  clubName,
  daysUntilEnd,
  trialEndDate,
  selectedTier,
  tierPriceMinor,
  currency,
  settingsUrl,
}: TrialEndingProps) {
  const headline =
    daysUntilEnd === 1 ? 'Your Cavaliq trial ends tomorrow' : 'Your Cavaliq trial ends in 3 days';

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{headline}</Heading>

          <Text style={styles.greeting}>Hi {recipientName},</Text>

          <Text style={styles.text}>
            {clubName}&apos;s 14-day Cavaliq trial ends on <strong>{trialEndDate}</strong>. After
            that the platform will issue your first monthly subscription invoice; nothing interrupts
            in the meantime, and you keep every booking, horse, and rider record you&apos;ve added
            during the trial.
          </Text>

          {selectedTier && tierPriceMinor != null ? (
            <Section style={styles.card}>
              <Text style={styles.label}>Your selected tier</Text>
              <Text style={styles.valueLarge}>{TIER_LABELS[selectedTier]}</Text>

              <Text style={styles.label}>Monthly</Text>
              <Text style={styles.value}>{formatCurrency(tierPriceMinor, currency)}</Text>

              <Text style={styles.text}>
                We&apos;ll email the first invoice on {trialEndDate} with a Ziina pay link. No
                card-on-file — every month is a fresh hosted-page click.
              </Text>
            </Section>
          ) : (
            <Section style={styles.card}>
              <Text style={styles.text}>
                <strong>Pick a tier</strong> in Settings → Subscription so we know which plan to
                bill on {trialEndDate}. Starter / Growing / Professional all include unlimited
                riders; they differ on the staff seat count and a few advanced features.
              </Text>
            </Section>
          )}

          <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
            <Button href={safeHref(settingsUrl)} style={styles.button}>
              Open Settings → Subscription
            </Button>
          </Section>

          <Hr style={styles.hr} />

          <Text style={styles.footer}>Cavaliq — equestrian club software</Text>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f9fafb',
    margin: '0',
    padding: '0',
  },
  container: { maxWidth: '600px', margin: '0 auto', padding: '40px 20px' },
  heading: { fontSize: '22px', fontWeight: '700' as const, color: '#1f2937', marginBottom: '8px' },
  greeting: { fontSize: '16px', color: '#374151', marginBottom: '4px' },
  text: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', lineHeight: '22px' },
  card: {
    backgroundColor: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    margin: '16px 0',
  },
  label: {
    fontSize: '11px',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    margin: '0 0 2px',
    fontWeight: '600' as const,
  },
  value: { fontSize: '14px', color: '#374151', fontWeight: '500' as const, margin: '0 0 12px' },
  valueLarge: {
    fontSize: '20px',
    color: '#1f2937',
    fontWeight: '700' as const,
    margin: '0 0 12px',
  },
  button: {
    backgroundColor: '#6366f1',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600' as const,
    textDecoration: 'none',
    display: 'inline-block',
  },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  footer: { fontSize: '12px', color: '#9ca3af', lineHeight: '20px' },
};
